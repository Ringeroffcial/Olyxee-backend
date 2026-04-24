import { v4 as uuidv4 } from 'uuid';
import EventEmitter from 'events';

// Job state management
class JobStore {
  #jobs = new Map();  // Private field
  
  set(jobId, jobData) {
    this.#jobs.set(jobId, jobData);
  }
  
  get(jobId) {
    return this.#jobs.get(jobId);
  }
  
  update(jobId, updates) {
    const existing = this.#jobs.get(jobId);
    if (existing) {
      this.#jobs.set(jobId, { ...existing, ...updates });
    }
    return this.#jobs.get(jobId);
  }
  
  has(jobId) {
    return this.#jobs.has(jobId);
  }
}

class OrdoService {
  #jobStore = new JobStore();
  #eventEmitter = new EventEmitter();
  
  // Validation schema
  #requiredFields = ['goal', 'plan', 'entities', 'constraints'];
  
  // ========== MAIN PROCESS METHOD ==========
  async process(payload) {
    console.log('📥 Received payload:', JSON.stringify(payload, null, 2));
    
    try {
      // 1. Validate structure
      this.#validateStructure(payload);
      
      // 2. Create job
      const job = this.#createJob(payload);
      
      // 3. Split plan into steps
      const { steps, stepsMap } = this.#splitPlanIntoSteps(payload.plan);
      
      // 4. Define execution order
      const executionOrder = this.#defineExecutionOrder(steps, payload.constraints);
      
      // Store steps in job
      this.#jobStore.update(job.id, { steps, executionOrder });
      
      // Async execution (don't block response)
      this.#executeJob(job.id, steps, executionOrder, payload.entities);
      
      return {
        jobId: job.id,
        totalSteps: steps.length,
        executionOrder: executionOrder.type,
        status: 'queued'
      };
      
    } catch (error) {
      throw new Error(`Processing failed: ${error.message}`);
    }
  }
  
  async getJobStatus(jobId) {
    const job = this.#jobStore.get(jobId);
    
    if (!job) {
      throw new Error('Job not found');
    }
    
    return {
      jobId: job.id,
      status: job.status,
      progress: job.progress,
      completedSteps: job.completedSteps ?? 0,
      totalSteps: job.steps?.length ?? 0,
      result: job.result,
      error: job.error,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt
    };
  } 
  // ========== 1. VALIDATE STRUCTURE (Private) ==========
  #validateStructure(payload) {
    // Check required fields
    const missingFields = this.#requiredFields.filter(
      field => !payload?.[field]
    );
    
    if (missingFields.length > 0) {
      throw new Error(`Missing required fields: ${missingFields.join(', ')}`);
    }
    
    // Validate plan is array
    if (!Array.isArray(payload.plan)) {
      throw new Error('Plan must be an array');
    }
    
    if (payload.plan.length === 0) {
      throw new Error('Plan cannot be empty');
    }
    // Validate each step has required properties
    payload.plan.forEach((step, index) => {
      if (!step.action) {
        throw new Error(`Step ${index + 1} missing 'action' property`);
      }
    });
    console.log('✅ Structure validation passed');
    return true;
  }

  #createJob(payload) {
    const job = {
      id: uuidv4(),
      goal: payload.goal,
      status: 'pending',
      progress: 0,
      completedSteps: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      entities: { ...payload.entities },
      constraints: { ...payload.constraints }
    };
    
    this.#jobStore.set(job.id, job);
    console.log(`📋 Job created: ${job.id}`);
    
    return job;
  }
  
  // ========== 3. SPLIT PLAN INTO STEPS (Private) ==========
  #splitPlanIntoSteps(plan) {
    const steps = plan.map((step, index) => ({
      id: uuidv4(),
      order: index,
      name: step.name ?? `Step_${index + 1}`,
      action: step.action,
      input: { ...step.input },
      dependencies: step.depends_on ?? [],
      status: 'pending',
      result: null,
      error: null,
      startedAt: null,
      completedAt: null
    }));
    
    // Create map for quick lookup
    const stepsMap = new Map(steps.map(step => [step.id, step]));
    
    console.log(`📊 Split plan into ${steps.length} steps`);
    return { steps, stepsMap };
  }
  
  // ========== 4. DEFINE EXECUTION ORDER (Private) ==========
  #defineExecutionOrder(steps, constraints) {
    const executionType = constraints?.execution_order ?? 'sequential';
    
    const strategies = {
      sequential: () => this.#buildSequentialOrder(steps),
      parallel: () => this.#buildParallelOrder(steps),
      dag: () => this.#buildDAGOrder(steps)
    };
    
    const strategy = strategies[executionType] ?? strategies.sequential;
    const order = strategy();
    
    console.log(`🔀 Execution order: ${executionType}`);
    
    return {
      type: executionType,
      order,
      maxRetries: constraints?.max_retries ?? 0,
      timeoutMs: constraints?.timeout_seconds ?? 30 * 1000
    };
  }
  
  #buildSequentialOrder(steps) {
    // Linear order based on step.order
    return steps.sort((a, b) => a.order - b.order).map(s => s.id);
  }
  
  #buildParallelOrder(steps) {
    // All steps can run in parallel (ignore dependencies)
    return [steps.map(s => s.id)];
  }
  
  #buildDAGOrder(steps) {
    // Topological sort for DAG
    const graph = new Map();
    const inDegree = new Map();
    
    // Initialize
    steps.forEach(step => {
      graph.set(step.id, [...step.dependencies]);
      inDegree.set(step.id, step.dependencies.length);
    });
    
    // Kahn's algorithm
    const queue = steps.filter(s => inDegree.get(s.id) === 0).map(s => s.id);
    const result = [];
    
    while (queue.length > 0) {
      const current = queue.shift();
      result.push(current);
      
      // Find steps that depend on current
      steps.forEach(step => {
        if (step.dependencies.includes(current)) {
          const newDegree = inDegree.get(step.id) - 1;
          inDegree.set(step.id, newDegree);
          
          if (newDegree === 0) {
            queue.push(step.id);
          }
        }
      });
    }
    
    // Check for cycles
    if (result.length !== steps.length) {
      throw new Error('Circular dependency detected in plan');
    }
    
    return result;
  }
  
  // ========== EXECUTE JOB (Private) ==========
  async #executeJob(jobId, steps, executionOrder, entities) {
    const job = this.#jobStore.get(jobId);
    job.status = 'running';
    job.updatedAt = new Date().toISOString();
    
    console.log(`🚀 Starting execution of job ${jobId}`);
    
    try {
      const results = await this.#runExecutionStrategy(
        executionOrder.type,
        steps,
        executionOrder.order,
        entities,
        executionOrder
      );
      
      // Update job as completed
      this.#jobStore.update(jobId, {
        status: 'completed',
        progress: 100,
        completedSteps: steps.length,
        result: results,
        updatedAt: new Date().toISOString()
      });
      
      console.log(`✅ Job ${jobId} completed successfully`);
      
    } catch (error) {
      // Update job as failed
      this.#jobStore.update(jobId, {
        status: 'failed',
        error: error.message,
        updatedAt: new Date().toISOString()
      });
      
      console.error(`❌ Job ${jobId} failed:`, error.message);
    }
  }
  
  async #runExecutionStrategy(type, steps, order, entities, config) {
    const stepMap = new Map(steps.map(s => [s.id, s]));
    
    switch (type) {
      case 'sequential':
        return this.#runSequential(order, stepMap, entities, config);
        
      case 'parallel':
        return this.#runParallel(order[0], stepMap, entities, config);
        
      case 'dag':
        return this.#runSequential(order, stepMap, entities, config);
        
      default:
        return this.#runSequential(order, stepMap, entities, config);
    }
  }
  
  async #runSequential(order, stepMap, entities, config) {
    const results = [];
    
    for (const stepId of order) {
      const step = stepMap.get(stepId);
      step.status = 'running';
      step.startedAt = new Date().toISOString();
      
      console.log(`⚙️ Executing step: ${step.name} (${step.action})`);
      
      try {
        const result = await this.#executeStep(step, entities, config);
        step.status = 'completed';
        step.result = result;
        results.push({ stepId, stepName: step.name, result });
        
      } catch (error) {
        step.status = 'failed';
        step.error = error.message;
        throw new Error(`Step ${step.name} failed: ${error.message}`);
      }
      
      step.completedAt = new Date().toISOString();
    }
    
    return results;
  }
  
  async #runParallel(stepIds, stepMap, entities, config) {
    const stepExecutions = stepIds.map(async (stepId) => {
      const step = stepMap.get(stepId);
      step.status = 'running';
      step.startedAt = new Date().toISOString();
      
      try {
        const result = await this.#executeStep(step, entities, config);
        step.status = 'completed';
        step.result = result;
        step.completedAt = new Date().toISOString();
        return { stepId, stepName: step.name, result };
      } catch (error) {
        step.status = 'failed';
        step.error = error.message;
        throw error;
      }
    });
    
    return Promise.all(stepExecutions);
  }
  
  async #executeStep(step, entities, config) {
    // Simulate step execution (replace with actual logic)
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Step ${step.name} timed out after ${config.timeoutMs}ms`));
      }, config.timeoutMs);
      
      // Simulate work
      setTimeout(() => {
        clearTimeout(timeout);
        
        // Mock execution based on action type
        const result = {
          action: step.action,
          input: step.input,
          entitiesUsed: entities,
          output: `Executed ${step.name} successfully`,
          timestamp: new Date().toISOString()
        };
        
        resolve(result);
      }, 100);
    });
  }
}

export default new OrdoService();