#!/usr/bin/env python3
"""
Simple Stress Test Script for AI Call Orchestrator
Tests retry logic and concurrency limits
"""

import requests
import time
import json
from threading import Thread
import sys

BASE_URL = "http://localhost:3000"

def create_call(phone_number, script_id="testScript"):
    """Create a single call"""
    try:
        response = requests.post(f"{BASE_URL}/calls", json={
            "to": phone_number,
            "scriptId": script_id,
            "metadata": {"test": True}
        })
        
        if response.status_code == 201:
            return response.json()
        else:
            print(f"❌ Failed to create call: {response.status_code}")
            return None
    except Exception as e:
        print(f"❌ Error creating call: {e}")
        return None

def get_call_status(call_id):
    """Get current status of a call"""
    try:
        response = requests.get(f"{BASE_URL}/calls/{call_id}")
        if response.status_code == 200:
            return response.json()
        return None
    except Exception as e:
        print(f"❌ Error getting call {call_id}: {e}")
        return None

def get_metrics():
    """Get current system metrics"""
    try:
        response = requests.get(f"{BASE_URL}/metrics")
        if response.status_code == 200:
            return response.json()
        return {}
    except Exception as e:
        print(f"❌ Error getting metrics: {e}")
        return {}

def test_basic_functionality():
    """Test basic API functionality first"""
    print("🧪 Testing Basic Functionality")
    print("=" * 50)
    
    # Test 1: Create a call
    print("1. Creating a test call...")
    call_data = create_call("+966501234567", "testScript")
    if call_data:
        call_id = call_data['id']
        print(f"   ✅ Call created: {call_id[:8]}...")
        
        # Test 2: Get the call
        print("2. Retrieving the call...")
        retrieved_call = get_call_status(call_id)
        if retrieved_call:
            print(f"   ✅ Call retrieved: {retrieved_call['status']}")
        
        # Test 3: Monitor status changes
        print("3. Monitoring call progress for 30 seconds...")
        for i in range(15):  # Check every 2 seconds for 30 seconds
            call_status = get_call_status(call_id)
            if call_status:
                print(f"   📞 Status: {call_status['status']} (attempts: {call_status['attempts']})")
                if call_status['status'] in ['COMPLETED', 'FAILED']:
                    print(f"   ✅ Call finished: {call_status['status']}")
                    break
            time.sleep(2)
    
    # Test 4: Get metrics
    print("4. Getting system metrics...")
    metrics = get_metrics()
    print(f"   📊 Metrics: {metrics}")
    
    print("\n")

def test_retry_logic_simple():
    """Simple test for retry logic"""
    print("🔄 Testing Retry Logic")
    print("=" * 50)
    
    print("Creating 5 calls to test retry behavior...")
    call_ids = []
    
    # Create 5 calls
    for i in range(5):
        phone = f"+966502000{i:03d}"
        print(f"Creating call {i+1} for {phone}")
        call_data = create_call(phone, "retryTest")
        if call_data:
            call_ids.append(call_data['id'])
    
    print(f"\n📊 Created {len(call_ids)} calls")
    print("Monitoring for retry behavior...")
    
    # Monitor calls for 2 minutes
    start_time = time.time()
    failed_calls = []
    completed_calls = []
    
    while time.time() - start_time < 120:  # 2 minutes
        for call_id in call_ids[:]:  # Copy list to avoid modification issues
            call_data = get_call_status(call_id)
            if call_data:
                status = call_data['status']
                attempts = call_data['attempts']
                
                if status == 'FAILED':
                    if call_id not in [c['id'] for c in failed_calls]:
                        failed_calls.append(call_data)
                        call_ids.remove(call_id)
                        print(f"   ❌ Call {call_id[:8]} FAILED after {attempts} attempts")
                
                elif status == 'COMPLETED':
                    if call_id not in [c['id'] for c in completed_calls]:
                        completed_calls.append(call_data)
                        call_ids.remove(call_id)
                        print(f"   ✅ Call {call_id[:8]} COMPLETED after {attempts} attempts")
        
        if not call_ids:  # All calls finished
            break
            
        time.sleep(3)
    
    print(f"\n📈 Retry Test Results:")
    print(f"   - Completed: {len(completed_calls)}")
    print(f"   - Failed after retries: {len(failed_calls)}")
    
    # Check if failed calls had proper retry count
    proper_retries = sum(1 for call in failed_calls if call['attempts'] >= 3)
    print(f"   - Failed calls with 3+ attempts: {proper_retries}/{len(failed_calls)}")
    
    print("\n")

def test_concurrency_simple():
    """Simple test for concurrency limits"""
    print("🚀 Testing Concurrency Limits")
    print("=" * 50)
    
    print("Creating 40 calls rapidly to test concurrency...")
    
    # Create calls rapidly
    call_ids = []
    for i in range(100):
        phone = f"+966503000{i:03d}"
        call_data = create_call(phone, "concurrencyTest")
        if call_data:
            call_ids.append(call_data['id'])
        time.sleep(0.1)  # Small delay to avoid overwhelming
    
    print(f"📊 Created {len(call_ids)} calls")
    print("\nMonitoring concurrent IN_PROGRESS calls...")
    
    max_concurrent = 0
    monitoring_time = 90  # Monitor for 90 seconds
    start_time = time.time()
    
    while time.time() - start_time < monitoring_time:
        metrics = get_metrics()
        in_progress = metrics.get('IN_PROGRESS', 0)
        pending = metrics.get('PENDING', 0)
        completed = metrics.get('COMPLETED', 0)
        failed = metrics.get('FAILED', 0)
        
        max_concurrent = max(max_concurrent, in_progress)
        
        print(f"   📊 IN_PROGRESS: {in_progress:2d} | PENDING: {pending:2d} | COMPLETED: {completed:2d} | FAILED: {failed:2d}")
        
        # Stop if no more pending or in_progress calls
        if pending == 0 and in_progress == 0:
            print("   ✅ All calls processed")
            break
            
        time.sleep(5)
    
    print(f"\n📈 Concurrency Test Results:")
    print(f"   - Maximum concurrent calls: {max_concurrent}")
    print(f"   - Expected limit: 30")
    print(f"   - Limit respected: {'✅ YES' if max_concurrent <= 30 else '❌ NO'}")
    
    print("\n")

def test_entity_locking_simple():
    """Simple test for entity locking"""
    print("🔒 Testing Entity Locking")
    print("=" * 50)
    
    duplicate_phone = "+966504444999"
    print(f"Creating 5 calls to the same number: {duplicate_phone}")
    
    # Create multiple calls to same phone
    call_ids = []
    for i in range(5):
        call_data = create_call(duplicate_phone, f"entityTest{i}")
        if call_data:
            call_ids.append(call_data['id'])
        time.sleep(0.5)
    
    print(f"📊 Created {len(call_ids)} calls to {duplicate_phone}")
    print("Monitoring to ensure only one is IN_PROGRESS at a time...")
    
    violations = 0
    monitoring_time = 60
    start_time = time.time()
    
    while time.time() - start_time < monitoring_time:
        in_progress_count = 0
        
        for call_id in call_ids:
            call_data = get_call_status(call_id)
            if call_data and call_data['status'] == 'IN_PROGRESS':
                in_progress_count += 1
        
        print(f"   📞 IN_PROGRESS calls for {duplicate_phone}: {in_progress_count}")
        
        if in_progress_count > 1:
            violations += 1
            print(f"   ❌ VIOLATION: {in_progress_count} calls IN_PROGRESS for same phone!")
        elif in_progress_count == 1:
            print(f"   ✅ Entity locking working correctly")
        
        time.sleep(3)
    
    print(f"\n📈 Entity Locking Results:")
    print(f"   - Violations detected: {violations}")
    print(f"   - Entity locking working: {'✅ YES' if violations == 0 else '❌ NO'}")
    
    print("\n")

def main():
    """Main test runner"""
    print("🧪 AI CALL ORCHESTRATOR STRESS TESTS")
    print("=" * 60)
    
    # Check if service is running
    try:
        response = requests.get(f"{BASE_URL}/metrics")
        if response.status_code != 200:
            print("❌ Service not responding. Make sure it's running on localhost:3000")
            return
    except Exception as e:
        print(f"❌ Cannot connect to service: {e}")
        print("Make sure your service is running on localhost:3000")
        return
    
    print("✅ Service is running\n")
    
    test_concurrency_simple()
    test_entity_locking_simple()
    # Final metrics
    print("🎯 FINAL SYSTEM STATUS")
    print("=" * 50)
    final_metrics = get_metrics()
    for status, count in final_metrics.items():
        print(f"   {status}: {count}")
    
    print("\n🎉 Tests completed!")

if __name__ == "__main__":
    main()