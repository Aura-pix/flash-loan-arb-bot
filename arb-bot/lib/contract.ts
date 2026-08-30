// SIMULATION MODE
// Since we are not connected to a live node yet, we mock the execution and store active simulations in memory.

export const activeSimulations = new Map<string, {
  status: 'pending' | 'success' | 'reverted',
  currentStep: number,
  steps: string[],
  startTime: number
}>();

export async function requestFlashLoan() {
  // Generate a mock transaction hash
  const txHash = '0x' + Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
  
  // Initialize simulation state
  activeSimulations.set(txHash, {
    status: 'pending',
    currentStep: 0,
    steps: ['loan_taken', 'swap_1', 'swap_2', 'repaid'],
    startTime: Date.now()
  });

  // Start the background progression (simulating blocks being mined and events firing)
  simulateTransaction(txHash);

  return txHash;
}

async function simulateTransaction(txHash: string) {
  const sim = activeSimulations.get(txHash);
  if (!sim) return;

  for (let i = 0; i < sim.steps.length; i++) {
    // Wait between 1.5 - 2.5 seconds per step
    await new Promise(resolve => setTimeout(resolve, 1500 + Math.random() * 1000));
    sim.currentStep = i + 1;
  }
  
  sim.status = 'success';
}
