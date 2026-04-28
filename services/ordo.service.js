import { v4 as uuidv4 } from 'uuid';
import EventEmitter from 'events';
import SiyandaEngine from '../engine/siyanda.engine.js';
import DecisionEngine from '../engine/decision.engine.js'; // Import DecisionEngine

// In-memory job state management (no database)
class JobStore {
  #jobs = new Map();  // Private field - all in memory
  
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
  
  delete(jobId) {
    return this.#jobs.delete(jobId);
  }
  
  getAll() {
    return Array.from(this.#jobs.values());
  }
}

class OrdoService {
  #jobStore = new JobStore();
  #eventEmitter = new EventEmitter();
  
  // Validation schema
  #requiredFields = ['goal', 'plan', 'entities', 'constraints'];
  
  // ========== MAIN PROCESS METHOD ==========
  async process(payload) {
    console.log('📥 [Mahlori] Received payload:', JSON.stringify(payload, null, 2));
    
    try {
      // 1. Validate structure (Mahlori's first responsibility)
      this.#validateStructure(payload);
      
      // 2. Create job with unique ID
      const job = this.#createJob(payload);
      
      // 3. Split plan into steps
      const { steps, stepsMap } = this.#splitPlanIntoSteps(payload.plan);
      
      // 4. Define execution order based on constraints
      const executionOrder = this.#defineExecutionOrder(steps, payload.constraints);
      
      // Store steps and execution order in job (in-memory)
      this.#jobStore.update(job.id, { 
        steps, 
        stepsMap,
        executionOrder,
        entities: payload.entities,
        constraints: payload.constraints
      });
      
      // 5. Pass to Siyanda for execution (async, don't block response)
      this.#executeJob(job.id, steps, executionOrder, payload.entities, payload.constraints);
      
      console.log(`✅ [Mahlori] Job ${job.id} queued successfully`);
      
      // Return immediate acknowledgment
      return {
        jobId: job.id,
        goal: payload.goal,
        totalSteps: steps.length,
        executionOrder: executionOrder.type,
        status: 'queued',
        timestamp: new Date().toISOString()
      };
      
    } catch (error) {
      console.error(`❌ [Mahlori] Processing failed: ${error.message}`);
      throw new Error(`Processing failed: ${error.message}`);
    }
  }
  
  // ========== GET JOB STATUS ==========
  async getJobStatus(jobId) {
    const job = this.#jobStore.get(jobId);
    
    if (!job) {
      throw new Error('Job not found');
    }
    
    return {
      jobId: job.id,
      goal: job.goal,
      status: job.status,
      progress: job.progress,
      completedSteps: job.completedSteps ?? 0,
      totalSteps: job.steps?.length ?? 0,
      result: job.result,
      finalDecision: job.finalDecision,
      reasons: job.reasons,
      actions: job.actions,
      decision: job.decision, // Add this for consistency
      error: job.error,
      blockingReason: job.blockingReason,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      completedAt: job.completedAt
    };
  }
  
  // ========== GET ALL JOBS ==========
  async getAllJobs() {
    return this.#jobStore.getAll().map(job => ({
      jobId: job.id,
      goal: job.goal,
      status: job.status,
      progress: job.progress,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt
    }));
  }
  
  // ========== 1. VALIDATE STRUCTURE (Mahlori) ==========
  #validateStructure(payload) {
    // Check required fields
    const missingFields = this.#requiredFields.filter(
      field => !payload?.[field]
    );
    
    if (missingFields.length > 0) {
      throw new Error(`Missing required fields: ${missingFields.join(', ')}`);
    }
    
    // Validate goal is present and non-empty
    if (typeof payload.goal !== 'string' || payload.goal.trim().length === 0) {
      throw new Error('Goal must be a non-empty string');
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
      
      // Validate action type is supported
      const supportedActions = [
        'log', 'calculate', 'transform_data', 'wait', 
        'send_notification', 'validate_compliance', 'branch',
        'mock_api_call', 'update_status', 'webhook',
        'fetch_provider_profile', 'fetch_compliance_documents',
        'evaluate_mandatory_requirements', 'evaluate_business_value',
        'detect_risk_conflicts', 'generate_decision', 'generate_final_decision'
      ];
      
      if (!supportedActions.includes(step.action)) {
        console.warn(`⚠️ Warning: Step ${index + 1} uses action '${step.action}' - make sure it's implemented in Siyanda`);
      }
    });
    
    // Validate entities is object
    if (typeof payload.entities !== 'object' || payload.entities === null) {
      throw new Error('Entities must be an object');
    }
    
    // Validate constraints is object
    if (typeof payload.constraints !== 'object' || payload.constraints === null) {
      throw new Error('Constraints must be an object');
    }
    
    console.log('✅ [Mahlori] Structure validation passed');
    return true;
  }
  
  // ========== 2. CREATE JOB (Mahlori) ==========
  #createJob(payload) {
    const job = {
      id: uuidv4(),
      goal: payload.goal,
      status: 'pending',
      progress: 0,
      completedSteps: 0,
      failedSteps: 0,
      blockedSteps: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      entities: { ...payload.entities },
      constraints: { ...payload.constraints },
      steps: [],
      stepsMap: new Map(),
      executionOrder: null,
      result: null,
      finalDecision: null,
      decision: null, // Add decision field
      reasons: [],
      actions: [],
      error: null,
      blockingReason: null
    };
    
    this.#jobStore.set(job.id, job);
    console.log(`📋 [Mahlori] Job created: ${job.id}`);
    
    return job;
  }
  
  // ========== 3. SPLIT PLAN INTO STEPS (Mahlori) ==========
  #splitPlanIntoSteps(plan) {
    const steps = plan.map((step, index) => ({
      id: uuidv4(),
      order: index,
      name: step.name ?? step.action ?? `Step_${index + 1}`,
      action: step.action,
      input: step.input ? { ...step.input } : {},
      dependencies: step.depends_on ?? [],
      status: 'pending', // pending, running, completed, failed, blocked, skipped
      result: null,
      error: null,
      retryCount: 0,
      startedAt: null,
      completedAt: null,
      metadata: step.metadata || {}
    }));
    
    // Create map for quick lookup
    const stepsMap = new Map(steps.map(step => [step.id, step]));
    
    console.log(`📊 [Mahlori] Split plan into ${steps.length} steps`);
    return { steps, stepsMap };
  }
  
  // ========== 4. DEFINE EXECUTION ORDER (Mahlori) ==========
  #defineExecutionOrder(steps, constraints) {
    const executionType = constraints?.execution_order ?? 'sequential';
    
    const strategies = {
      sequential: () => this.#buildSequentialOrder(steps),
      parallel: () => this.#buildParallelOrder(steps),
      dag: () => this.#buildDAGOrder(steps)
    };
    
    const strategy = strategies[executionType];
    if (!strategy) {
      throw new Error(`Unsupported execution order type: ${executionType}`);
    }
    
    const order = strategy();
    
    console.log(`🔀 [Mahlori] Execution order: ${executionType}`);
    
    return {
      type: executionType,
      order,
      maxRetries: constraints?.max_retries ?? 0,
      timeoutMs: (constraints?.timeout_seconds ?? 30) * 1000,
      onError: constraints?.on_error ?? 'fail', // fail, continue, retry
      rollbackOnFailure: constraints?.rollback_on_failure ?? false
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
    // Topological sort for DAG based on dependencies
    const graph = new Map();
    const inDegree = new Map();
    
    // Initialize graph
    steps.forEach(step => {
      graph.set(step.id, [...step.dependencies]);
      inDegree.set(step.id, step.dependencies.length);
    });
    
    // Kahn's algorithm for topological sort
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
  
  // ========== EXECUTE JOB (Mahlori passes to Siyanda) ==========
  async #executeJob(jobId, steps, executionOrder, entities, constraints) {
    const job = this.#jobStore.get(jobId);
    job.status = 'running';
    job.updatedAt = new Date().toISOString();
    
    console.log(`🚀 [Mahlori] Starting execution of job ${jobId}, delegating to Siyanda`);
    
    try {
      const results = await this.#runExecutionStrategy(
        executionOrder.type,
        steps,
        executionOrder.order,
        entities,
        executionOrder,
        constraints,
        jobId
      );
      
      // Determine final outcome based on results
      const finalOutcome = this.#determineFinalOutcome(results, constraints, entities);
      
      // Update job as completed
      this.#jobStore.update(jobId, {
        status: finalOutcome.status,
        progress: 100,
        completedSteps: steps.filter(s => s.status === 'completed').length,
        failedSteps: steps.filter(s => s.status === 'failed').length,
        blockedSteps: steps.filter(s => s.status === 'blocked').length,
        result: results,
        finalDecision: finalOutcome.decision,
        decision: finalOutcome.decision,
        reasons: finalOutcome.reasons,
        actions: finalOutcome.actions,
        completedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
      
      console.log(`✅ [Mahlori] Job ${jobId} completed with status: ${finalOutcome.status}`);
      console.log(`📊 Decision: ${finalOutcome.decision}`);
      console.log(`📝 Reasons: ${finalOutcome.reasons.join(', ')}`);
      console.log(`⚡ Actions: ${finalOutcome.actions.join(', ')}`);
      
      // Emit event for listeners
      this.#eventEmitter.emit('jobCompleted', {
        jobId,
        status: finalOutcome.status,
        decision: finalOutcome.decision,
        reasons: finalOutcome.reasons,
        actions: finalOutcome.actions
      });
      
    } catch (error) {
      // Update job as failed or blocked
      const status = error.type === 'blocked' ? 'blocked' : 'failed';
      
      this.#jobStore.update(jobId, {
        status: status,
        decision: status === 'blocked' ? 'blocked' : 'failed',
        finalDecision: status === 'blocked' ? 'Workflow blocked' : 'Workflow failed',
        error: error.message,
        blockingReason: error.type === 'blocked' ? error.reason : null,
        updatedAt: new Date().toISOString(),
        completedAt: new Date().toISOString()
      });
      
      console.error(`❌ [Mahlori] Job ${jobId} ${status}:`, error.message);
      
      // Emit error event
      this.#eventEmitter.emit('jobFailed', {
        jobId,
        status,
        error: error.message
      });
    }
  }
  
  // ========== RUN EXECUTION STRATEGY ==========
  async #runExecutionStrategy(type, steps, order, entities, config, constraints, jobId) {
    const stepMap = new Map(steps.map(s => [s.id, s]));
    
    switch (type) {
      case 'sequential':
        return this.#runSequential(order, stepMap, entities, config, constraints, jobId);
        
      case 'parallel':
        return this.#runParallel(order[0], stepMap, entities, config, constraints, jobId);
        
      case 'dag':
        return this.#runSequential(order, stepMap, entities, config, constraints, jobId);
        
      default:
        return this.#runSequential(order, stepMap, entities, config, constraints, jobId);
    }
  }
  
  // ========== SEQUENTIAL EXECUTION ==========
  async #runSequential(order, stepMap, entities, config, constraints, jobId) {
    const results = [];
    let currentEntities = { ...entities };
    
    for (const stepId of order) {
      const step = stepMap.get(stepId);
      step.status = 'running';
      step.startedAt = new Date().toISOString();
      
      console.log(`⚙️ [Mahlori -> Siyanda] Executing step: ${step.name} (${step.action})`);
      
      try {
        // Special handling for generate_decision steps - use DecisionEngine
        let result;
        if (step.action === 'generate_decision' || step.action === 'generate_final_decision') {
          console.log('🎯 Using DecisionEngine for final decision');
          const decisionResult = DecisionEngine.generateDecisions(currentEntities);
          result = {
            success: true,
            data: decisionResult,
            requiresAction: decisionResult.status === 'blocked',
            metadata: {
              action: step.action,
              executedBy: 'DecisionEngine',
              timestamp: new Date().toISOString(),
              jobId,
              attempt: 1
            }
          };
        } else {
          // Pass to Siyanda for actual execution
          result = await this.#executeStepWithRetry(
            step, 
            currentEntities, 
            config, 
            constraints,
            jobId
          );
        }
        
        step.status = 'completed';
        step.result = result;
        results.push({ 
          stepId, 
          stepName: step.name, 
          action: step.action,
          result,
          timestamp: new Date().toISOString()
        });
        
        // Update entities with results if needed
        if (result.data && result.data.updatedEntities) {
          currentEntities = { ...currentEntities, ...result.data.updatedEntities };
        }
        
        // If this was a decision step, store the decision data
        if ((step.action === 'generate_decision' || step.action === 'generate_final_decision') && result.data) {
          console.log('💾 Storing decision from DecisionEngine');
          this.#jobStore.update(jobId, {
            decision: result.data.decision,
            finalDecision: result.data.decision,
            reasons: result.data.reasons || result.data.blockers || [],
            actions: result.data.actions || []
          });
        }
        
        // Update job progress
        const completedCount = Array.from(stepMap.values()).filter(s => s.status === 'completed').length;
        this.#jobStore.update(jobId, {
          progress: Math.floor((completedCount / stepMap.size) * 100),
          completedSteps: completedCount,
          updatedAt: new Date().toISOString()
        });
        
      } catch (error) {
        step.status = error.type === 'blocked' ? 'blocked' : 'failed';
        step.error = error.message;
        
        // Handle based on error configuration
        if (config.onError === 'continue' && error.type !== 'blocked') {
          console.warn(`⚠️ Step ${step.name} failed but continuing: ${error.message}`);
          results.push({ 
            stepId, 
            stepName: step.name, 
            error: error.message,
            skipped: true
          });
          continue;
        } else if (config.onError === 'retry' && step.retryCount < config.maxRetries) {
          step.retryCount++;
          console.log(`🔄 Retrying step ${step.name} (attempt ${step.retryCount}/${config.maxRetries})`);
          step.status = 'pending';
          // Re-execute the same step
          const retryResult = await this.#executeStepWithRetry(
            step, 
            currentEntities, 
            config, 
            constraints,
            jobId
          );
          step.status = 'completed';
          step.result = retryResult;
          results.push({ 
            stepId, 
            stepName: step.name, 
            action: step.action,
            result: retryResult,
            retried: true,
            timestamp: new Date().toISOString()
          });
        } else {
          // Fail or block the entire job
          throw error;
        }
      }
      
      step.completedAt = new Date().toISOString();
    }
    
    return results;
  }
  
  // ========== PARALLEL EXECUTION ==========
  async #runParallel(stepIds, stepMap, entities, config, constraints, jobId) {
    const stepExecutions = stepIds.map(async (stepId) => {
      const step = stepMap.get(stepId);
      step.status = 'running';
      step.startedAt = new Date().toISOString();
      
      try {
        let result;
        if (step.action === 'generate_decision' || step.action === 'generate_final_decision') {
          const decisionResult = DecisionEngine.generateDecisions(entities);
          result = {
            success: true,
            data: decisionResult,
            requiresAction: decisionResult.status === 'blocked',
            metadata: {
              action: step.action,
              executedBy: 'DecisionEngine',
              timestamp: new Date().toISOString(),
              jobId,
              attempt: 1
            }
          };
        } else {
          result = await this.#executeStepWithRetry(
            step, 
            entities, 
            config, 
            constraints,
            jobId
          );
        }
        
        step.status = 'completed';
        step.result = result;
        step.completedAt = new Date().toISOString();
        
        return { stepId, stepName: step.name, action: step.action, result };
      } catch (error) {
        step.status = error.type === 'blocked' ? 'blocked' : 'failed';
        step.error = error.message;
        throw error;
      }
    });
    
    const results = await Promise.allSettled(stepExecutions);
    
    // Update progress
    const completedCount = Array.from(stepMap.values()).filter(s => s.status === 'completed').length;
    this.#jobStore.update(jobId, {
      progress: Math.floor((completedCount / stepMap.size) * 100),
      completedSteps: completedCount,
      updatedAt: new Date().toISOString()
    });
    
    // Filter and return only fulfilled results
    return results
      .filter(r => r.status === 'fulfilled')
      .map(r => r.value);
  }
  
  // ========== EXECUTE STEP WITH RETRY LOGIC ==========
  async #executeStepWithRetry(step, entities, config, constraints, jobId, attempt = 1) {
    let lastError = null;
    
    for (let currentAttempt = attempt; currentAttempt <= config.maxRetries + 1; currentAttempt++) {
      try {
        // Delegate to Siyanda for actual execution
        const result = await SiyandaEngine.executeStep(
          step,
          entities,
          constraints,
          config,
          jobId,
          currentAttempt
        );
        
        return result;
        
      } catch (error) {
        lastError = error;
        
        if (currentAttempt <= config.maxRetries && error.retryable !== false) {
          const delay = Math.min(1000 * Math.pow(2, currentAttempt - 1), 10000);
          console.log(`🔄 Retry ${currentAttempt}/${config.maxRetries} for step ${step.name} after ${delay}ms`);
          await new Promise(resolve => setTimeout(resolve, delay));
        } else {
          break;
        }
      }
    }
    
    throw lastError;
  }
  
  // ========== DETERMINE FINAL OUTCOME ==========
  #determineFinalOutcome(results, constraints, entities) {
    // First, check if we have a decision from DecisionEngine
    const decisionStep = results.find(r => 
      r.action === 'generate_decision' || 
      r.action === 'generate_final_decision' ||
      r.result?.data?.decision
    );
    
    if (decisionStep && decisionStep.result && decisionStep.result.data) {
      const decisionData = decisionStep.result.data;
      
      // Map DecisionEngine output to required format
      let status = 'completed';
      let decision = decisionData.decision || 'pending';
      
      // Determine status based on decision
      if (decisionData.decision === 'blocked') {
        status = 'blocked';
      } else if (decisionData.decision === 'conditionally_approved') {
        status = 'completed';
        decision = 'conditionally_approved';
      } else if (decisionData.decision === 'approved') {
        status = 'completed';
        decision = 'approved';
      } else if (decisionData.status === 'blocked') {
        status = 'blocked';
      }
      
      // Collect reasons (prioritize blockers, then reasons)
      const reasons = [];
      if (decisionData.blockers && decisionData.blockers.length > 0) {
        reasons.push(...decisionData.blockers);
      }
      if (decisionData.reasons && decisionData.reasons.length > 0) {
        reasons.push(...decisionData.reasons);
      }
      
      // Collect actions
      const actions = decisionData.actions || [];
      
      return {
        status,
        decision,
        reasons: reasons.length > 0 ? reasons : ['No specific reasons provided'],
        actions: actions.length > 0 ? actions : ['Review decision details']
      };
    }
    
    // Fallback: Analyze results for errors/blockers
    const failedSteps = results.filter(r => r.error);
    const blockedSteps = results.filter(r => r.result?.status === 'blocked' || r.blocked);
    const requiresActionSteps = results.filter(r => r.result?.requiresAction === true);
    
    let status = 'completed';
    let decision = 'Goal achieved successfully';
    const reasons = [];
    const actions = [];
    
    if (blockedSteps.length > 0) {
      status = 'blocked';
      decision = 'blocked';
      blockedSteps.forEach(step => {
        reasons.push(step.error || step.result?.reason || 'Constraint violation');
      });
      actions.push('Review constraints and modify input', 'Retry with corrected data');
    } else if (requiresActionSteps.length > 0) {
      status = 'requires_action';
      decision = 'Manual intervention required';
      requiresActionSteps.forEach(step => {
        reasons.push(step.result?.message || 'Manual action needed');
        if (step.result?.actions) actions.push(...step.result.actions);
      });
    } else if (failedSteps.length > 0) {
      status = 'failed';
      decision = 'failed';
      failedSteps.forEach(step => {
        reasons.push(step.error || 'Unknown error');
      });
      actions.push('Check execution logs', 'Verify step inputs', 'Retry the workflow');
    } else {
      // All steps completed successfully
      status = 'completed';
      decision = 'completed';
      reasons.push('All steps executed without errors');
      actions.push('Workflow complete - no further action needed');
    }
    
    return { status, decision, reasons, actions };
  }
  
  // ========== EVENT HANDLERS ==========
  on(event, callback) {
    this.#eventEmitter.on(event, callback);
  }
  
  off(event, callback) {
    this.#eventEmitter.off(event, callback);
  }
  
  once(event, callback) {
    this.#eventEmitter.once(event, callback);
  }
  
  // ========== CLEANUP ==========
  async cleanup(maxAgeHours = 24) {
    const jobs = this.#jobStore.getAll();
    const now = new Date();
    let cleaned = 0;
    
    for (const job of jobs) {
      const age = (now - new Date(job.completedAt || job.createdAt)) / (1000 * 60 * 60);
      if (age > maxAgeHours) {
        this.#jobStore.delete(job.id);
        cleaned++;
      }
    }
    
    console.log(`🧹 Cleaned up ${cleaned} old jobs from memory`);
    return cleaned;
  }
  
  // ========== GET STATISTICS ==========
  getStats() {
    const jobs = this.#jobStore.getAll();
    return {
      totalJobs: jobs.length,
      completed: jobs.filter(j => j.status === 'completed').length,
      failed: jobs.filter(j => j.status === 'failed').length,
      blocked: jobs.filter(j => j.status === 'blocked').length,
      running: jobs.filter(j => j.status === 'running').length,
      pending: jobs.filter(j => j.status === 'pending').length,
      requiresAction: jobs.filter(j => j.status === 'requires_action').length,
      memoryUsage: process.memoryUsage().heapUsed / 1024 / 1024 + ' MB'
    };
  }
}

export default new OrdoService();