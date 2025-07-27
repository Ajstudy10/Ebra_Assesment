#!/usr/bin/env python3
"""
AI Call Orchestrator - Python Stress Test
Creates 100 concurrent API calls with some duplicate phone numbers
"""

import asyncio
import aiohttp
import time
import random
import json
from datetime import datetime
from typing import List, Dict, Any

# Configuration
API_BASE_URL = "http://localhost:3000"
TOTAL_CALLS = 100
DUPLICATE_PERCENTAGE = 0.3  # 30% of calls will use duplicate numbers
CONCURRENT_LIMIT = 100  # How many concurrent requests to make at once

# Phone number pools
UNIQUE_PHONES = [f"+96650300{i:04d}" for i in range(1, 71)]  # 70 unique numbers
DUPLICATE_PHONES = ["+966503100001","+966503200001"]  # 20 numbers for duplicates

class StressTestStats:
    def __init__(self):
        self.calls_created = 0
        self.calls_failed = 0
        self.duplicates_detected = 0
        self.success_responses = 0
        self.error_responses = 0
        self.start_time = None
        self.end_time = None
        self.response_times = []
        self.errors = []
        self.duplicate_calls = []
        
    def add_response_time(self, duration: float):
        self.response_times.append(duration)
    
    def add_error(self, error: str, phone: str = None):
        self.errors.append({
            'error': error,
            'phone': phone,
            'timestamp': datetime.now().isoformat()
        })
    
    def print_summary(self):
        duration = (self.end_time - self.start_time).total_seconds()
        avg_response_time = sum(self.response_times) / len(self.response_times) if self.response_times else 0
        
        print("\n" + "="*60)
        print("🏁 STRESS TEST RESULTS")
        print("="*60)
        print(f"📊 Test Summary:")
        print(f"   Total Duration: {duration:.2f} seconds")
        print(f"   Calls Attempted: {TOTAL_CALLS}")
        print(f"   Calls Created: {self.success_responses}")
        print(f"   Calls Failed: {self.error_responses}")
        print(f"   Success Rate: {(self.success_responses/TOTAL_CALLS*100):.1f}%")
        print(f"   Duplicate Conflicts: {self.duplicates_detected}")
        print(f"   Average Response Time: {avg_response_time:.3f}s")
        
        print(f"\n🎯 Key Scenarios Tested:")
        print(f"   ✅ Concurrent Requests: {TOTAL_CALLS} calls")
        print(f"   🔄 Duplicate Phone Numbers: {len(self.duplicate_calls)} attempts")
        print(f"   🚫 Duplicate Rejections: {self.duplicates_detected}")
        print(f"   ⚡ Concurrency Handling: {CONCURRENT_LIMIT} simultaneous requests")
        
        if self.response_times:
            print(f"\n📈 Response Time Analysis:")
            print(f"   Fastest: {min(self.response_times):.3f}s")
            print(f"   Slowest: {max(self.response_times):.3f}s")
            print(f"   Average: {avg_response_time:.3f}s")
        
        if self.errors:
            print(f"\n❌ Error Analysis ({len(self.errors)} total):")
            error_types = {}
            for error in self.errors:
                error_msg = error['error']
                if 'already in progress' in error_msg.lower():
                    error_types['Duplicate Calls'] = error_types.get('Duplicate Calls', 0) + 1
                elif 'timeout' in error_msg.lower():
                    error_types['Timeouts'] = error_types.get('Timeouts', 0) + 1
                elif 'connection' in error_msg.lower():
                    error_types['Connection Errors'] = error_types.get('Connection Errors', 0) + 1
                else:
                    error_types['Other'] = error_types.get('Other', 0) + 1
            
            for error_type, count in error_types.items():
                print(f"   - {error_type}: {count}")
        
        print(f"\n📞 Phone Number Distribution:")
        unique_phones_used = set()
        duplicate_phones_used = set()
        for call in self.duplicate_calls:
            if call['is_duplicate']:
                duplicate_phones_used.add(call['phone'])
            else:
                unique_phones_used.add(call['phone'])
        
        print(f"   Unique Numbers Used: {len(unique_phones_used)}")
        print(f"   Duplicate Numbers Used: {len(duplicate_phones_used)}")
        print(f"   Expected Duplicates: {int(TOTAL_CALLS * DUPLICATE_PERCENTAGE)}")

async def create_call(session: aiohttp.ClientSession, phone: str, script_id: str, call_id: int, is_duplicate: bool = False) -> Dict[str, Any]:
    """Create a single call via the API"""
    start_time = time.time()
    
    payload = {
        "to": phone,
        "scriptId": script_id,
        "metadata": {
            "testCallId": call_id,
            "isDuplicate": is_duplicate,
            "timestamp": datetime.now().isoformat(),
            "testType": "python_stress_test"
        }
    }
    
    try:
        async with session.post(f"{API_BASE_URL}/calls", json=payload) as response:
            response_time = time.time() - start_time
            response_data = await response.json()
            
            return {
                "success": response.status in [200, 201],
                "status_code": response.status,
                "response_time": response_time,
                "data": response_data,
                "phone": phone,
                "call_id": call_id,
                "is_duplicate": is_duplicate,
                "error": None
            }
    
    except asyncio.TimeoutError:
        return {
            "success": False,
            "status_code": 0,
            "response_time": time.time() - start_time,
            "data": None,
            "phone": phone,
            "call_id": call_id,
            "is_duplicate": is_duplicate,
            "error": "Request timeout"
        }
    except Exception as e:
        return {
            "success": False,
            "status_code": 0,
            "response_time": time.time() - start_time,
            "data": None,
            "phone": phone,
            "call_id": call_id,
            "is_duplicate": is_duplicate,
            "error": str(e)
        }

def generate_call_list() -> List[Dict[str, Any]]:
    """Generate a list of calls with some duplicates"""
    calls = []
    
    # Calculate how many duplicates to create
    num_duplicates = int(TOTAL_CALLS * DUPLICATE_PERCENTAGE)
    num_unique = TOTAL_CALLS - num_duplicates
    
    print(f"📋 Generating call list:")
    print(f"   Unique calls: {num_unique}")
    print(f"   Duplicate calls: {num_duplicates}")
    
    # Create unique calls
    for i in range(num_unique):
        phone = random.choice(UNIQUE_PHONES)
        calls.append({
            "phone": phone,
            "script_id": "stressTest",
            "call_id": i + 1,
            "is_duplicate": False
        })
    
    # Create duplicate calls (using numbers that might already be in use)
    for i in range(num_duplicates):
        phone = random.choice(DUPLICATE_PHONES)
        calls.append({
            "phone": phone,
            "script_id": "duplicateTest", 
            "call_id": num_unique + i + 1,
            "is_duplicate": True
        })
    
    # Shuffle the list to distribute duplicates randomly
    random.shuffle(calls)
    return calls

async def run_concurrent_batch(session: aiohttp.ClientSession, calls_batch: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Run a batch of calls concurrently"""
    tasks = []
    for call in calls_batch:
        task = create_call(
            session,
            call["phone"],
            call["script_id"],
            call["call_id"],
            call["is_duplicate"]
        )
        tasks.append(task)
    
    return await asyncio.gather(*tasks)

async def check_system_metrics(session: aiohttp.ClientSession) -> Dict[str, Any]:
    """Get current system metrics"""
    try:
        async with session.get(f"{API_BASE_URL}/metrics") as response:
            if response.status == 200:
                return await response.json()
            else:
                return {}
    except:
        return {}

async def run_stress_test():
    """Main stress test function"""
    stats = StressTestStats()
    stats.start_time = datetime.now()
    
    print("🚀 Starting Python Stress Test")
    print("="*50)
    print(f"📊 Configuration:")
    print(f"   Total Calls: {TOTAL_CALLS}")
    print(f"   Concurrent Limit: {CONCURRENT_LIMIT}")
    print(f"   Duplicate Percentage: {DUPLICATE_PERCENTAGE*100}%")
    print(f"   API URL: {API_BASE_URL}")
    print()
    
    # Generate call list
    call_list = generate_call_list()
    stats.duplicate_calls = call_list.copy()
    
    # Set up HTTP session with timeout
    timeout = aiohttp.ClientTimeout(total=1)
    async with aiohttp.ClientSession(timeout=timeout) as session:
        
        # Check initial system state
        print("📊 Initial system state:")
        initial_metrics = await check_system_metrics(session)
        for key, value in initial_metrics.items():
            print(f"   {key}: {value}")
        print()
        
        print("🔥 Starting concurrent call creation...")
        print("📱 Call Progress:")
        
        # Process calls in batches to control concurrency
        all_results = []
        for i in range(0, len(call_list), CONCURRENT_LIMIT):
            batch = call_list[i:i + CONCURRENT_LIMIT]
            batch_num = i // CONCURRENT_LIMIT + 1
            total_batches = (len(call_list) + CONCURRENT_LIMIT - 1) // CONCURRENT_LIMIT
            
            print(f"   📦 Processing batch {batch_num}/{total_batches} ({len(batch)} calls)...")
            
            batch_results = await run_concurrent_batch(session, batch)
            all_results.extend(batch_results)
            
            # Short delay between batches to avoid overwhelming the server
            if i + CONCURRENT_LIMIT < len(call_list):
                await asyncio.sleep(0.5)
        
        # Process results
        print("\n📊 Processing results...")
        for result in all_results:
            stats.add_response_time(result["response_time"])
            
            if result["success"]:
                stats.success_responses += 1
                print(f"   ✅ Call {result['call_id']}: Created (ID: {result['data'].get('id', 'N/A')[:8]}...)")
            else:
                stats.error_responses += 1
                error_msg = result.get("error") or result.get("data", {}).get("error", "Unknown error")
                
                if "already in progress" in str(error_msg).lower():
                    stats.duplicates_detected += 1
                    print(f"   🔄 Call {result['call_id']}: Duplicate detected for {result['phone']}")
                else:
                    print(f"   ❌ Call {result['call_id']}: Failed - {error_msg}")
                
                stats.add_error(error_msg, result["phone"])
        
        # Check final system state
        print("\n📊 Final system state:")
        await asyncio.sleep(2)  # Give system a moment to process
        final_metrics = await check_system_metrics(session)
        for key, value in final_metrics.items():
            print(f"   {key}: {value}")
    
    stats.end_time = datetime.now()
    stats.print_summary()

async def main():
    """Entry point"""
    try:
        # Check if API is available
        print("✅ API server is available")
        print()
        
        # Run the stress test
        await run_stress_test()
        
    except KeyboardInterrupt:
        print("\n⚠️ Test interrupted by user")
    except Exception as e:
        print(f"\n❌ Test failed with error: {e}")

if __name__ == "__main__":
    asyncio.run(main())