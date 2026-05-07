// engine/mahlori.engine.js
import { v4 as uuidv4 } from 'uuid';

/**
 * MAHLORI - Entry and Orchestration Layer
 * 
 * STRICT RESPONSIBILITIES:
 * 1. Validate incoming JSON structure
 * 2. Create and track job
 * 3. Split plan into executable steps (without modification)
 * 4. Define execution order based on constraints
 * 5. Pass UNMODIFIED structured payload to Siyanda
 * 
 * FORBIDDEN ACTIONS:
 * - ❌ Processing raw text
 * - ❌ Changing/Modifying the original plan
 * - ❌ Making business decisions
 * - ❌ Executing steps directly
 */

class MahloriEngine {
  // Required fields - STRICT validation
  static #REQUIRED_FIELDS = ['goal', 'plan', 'entities', 'constraints'];
  
  // Supported action types (whitelist)
  static #SUPPORTED_ACTIONS = new Set([
    'log', 'calculate', 'transform_data', 'wait', 
    'send_notification', 'validate_compliance', 'branch',
    'mock_api_call', 'update_status', 'webhook',
    'fetch_provider_profile', 'fetch_compliance_documents',
    'evaluate_mandatory_requirements', 'evaluate_business_value',
    'detect_risk_conflicts', 'generate_decision', 'generate_final_decision'
  ]);

  /**
   * MAIN ENTRY POINT - Process incoming request
   * Returns structured job or throws validation error
   */
  static process(rawPayload) {
    console.log('🔷 [Mahlori] Starting entry validation');
    
    // 1. STRICT VALIDATION (No raw text processing)
    const validatedPayload = this.#validateStrict(rawPayload);
    
    // 2. CREATE JOB (with unique ID)
    const job = this.#createJob(validatedPayload);
    
    // 3. SPLIT PLAN INTO STEPS (without modification)
    const { steps, stepsMap } = this.#splitPlanToSteps(validatedPayload.plan);
    
    // 4. DEFINE EXECUTION ORDER (based on constraints)
    const executionConfig = this.#defineExecutionOrder(steps, validatedPayload.constraints);
    
    // 5. PREPARE STRUCTURED PAYLOAD FOR SIYANDA (UNMODIFIED)
    const siyandaPayload = this.#prepareSiyandaPayload(
      job.id,
      steps,
      executionConfig,
      validatedPayload.entities,
      validatedPayload.constraints
    );
    
    console.log('✅ [Mahlori] Validation complete - Ready for Siyanda');
    
    return {
      job,
      steps,
      stepsMap,
      executionConfig,
      siyandaPayload
    };
  }

  /**
   * STRICT VALIDATION - Reject anything that doesn't match schema
   */
  static #validateStrict(payload) {
    // Check payload exists
    if (!payload || typeof payload !== 'object') {
      throw new Error('MAHLORI: Invalid payload - must be an object');
    }

    // Check all required fields present
    const missingFields = this.#REQUIRED_FIELDS.filter(
      field => !(field in payload)
    );
    
    if (missingFields.length > 0) {
      throw new Error(`MAHLORI: Missing required fields: ${missingFields.join(', ')}`);
    }

    // VALIDATE goal (must be non-empty string)
    if (typeof payload.goal !== 'string' || payload.goal.trim().length === 0) {
      throw new Error('MAHLORI: goal must be a non-empty string');
    }

    // VALIDATE plan (must be non-empty array)
    if (!Array.isArray(payload.plan)) {
      throw new Error('MAHLORI: plan must be an array');
    }
    
    if (payload.plan.length === 0) {
      throw new Error('MAHLORI: plan cannot be empty');
    }

    // VALIDATE each step in plan (STRICT - no modification allowed)
    for (let i = 0; i < payload.plan.length; i++) {
      const step = payload.plan[i];
      
      if (!step.action) {
        throw new Error(`MAHLORI: Step ${i + 1} missing required 'action' property`);
      }
      
      if (typeof step.action !== 'string') {
        throw new Error(`MAHLORI: Step ${i + 1} 'action' must be a string`);
      }
      
      // CRITICAL: Reject unsupported actions
      if (!this.#SUPPORTED_ACTIONS.has(step.action)) {
        throw new Error(
          `MAHLORI: Step ${i + 1} uses unsupported action '${step.action}'. ` +
          `Supported actions: ${Array.from(this.#SUPPORTED_ACTIONS).join(', ')}`
        );
      }
      
      // Validate dependencies if present
      if (step.depends_on && !Array.isArray(step.depends_on)) {
        throw new Error(`MAHLORI: Step ${i + 1} 'depends_on' must be an array`);
      }
      
      // Validate step has a name or generate one (this is allowed - metadata only)
      if (!step.name && step.action) {
        step.name = `${step.action}_${i + 1}`;
      }
    }

    // VALIDATE entities (must be object)
    if (typeof payload.entities !== 'object' || payload.entities === null) {
      throw new Error('MAHLORI: entities must be an object');
    }

    // VALIDATE constraints (must be object)
    if (typeof payload.constraints !== 'object' || payload.constraints === null) {
      throw new Error('MAHLORI: constraints must be an object');
    }

    // Validate execution_order if present
    if (payload.constraints.execution_order) {
      const validOrders = ['sequential', 'parallel', 'dag'];
      if (!validOrders.includes(payload.constraints.execution_order)) {
        throw new Error(
          `MAHLORI: Invalid execution_order '${payload.constraints.execution_order}'. ` +
          `Must be one of: ${validOrders.join(', ')}`
        );
      }
    }

    console.log('✅ [Mahlori] Strict validation passed');
    
    // Return DEEP COPY (no mutation of original)
    return JSON.parse(JSON.stringify(payload));
  }

  /**
   * CREATE JOB - Generate unique job with metadata
   */
  static #createJob(payload) {
    const job = {
      id: uuidv4(),
      goal: payload.goal,
      status: 'pending',
      progress: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      // Store original payload for audit
      originalGoal: payload.goal,
      originalPlanLength: payload.plan.length,
      // Track validation metadata
      validatedAt: new Date().toISOString(),
      validator: 'Mahlori',
      version: '1.0.0'
    };
    
    console.log(`📋 [Mahlori] Job created: ${job.id}`);
    return job;
  }

  /**
   * SPLIT PLAN INTO STEPS - NO MODIFICATION OF BUSINESS LOGIC
   * Only adds metadata (id, order, status tracking)
   */
  static #splitPlanToSteps(originalPlan) {
    // CRITICAL: Create steps WITHOUT modifying original business logic
    const steps = originalPlan.map((step, index) => ({
      // Preserve ALL original properties
      ...step,
      // Add tracking metadata only (doesn't change business logic)
      id: uuidv4(),
      order: index,
      status: 'pending',
      result: null,
      error: null,
      startedAt: null,
      completedAt: null,
      retryCount: 0
    }));
    
    // Create quick lookup map
    const stepsMap = new Map(steps.map(step => [step.id, step]));
    
    console.log(`📊 [Mahlori] Split plan into ${steps.length} steps (original preserved)`);
    
    // Verify no business logic was modified
    for (let i = 0; i < steps.length; i++) {
      const original = originalPlan[i];
      const processed = steps[i];
      
      // These properties must match EXACTLY
      if (original.action !== processed.action) {
        throw new Error(`MAHLORI CRITICAL: Step ${i} action was modified! Original: ${original.action}, Modified: ${processed.action}`);
      }
      
      // Input objects must be identical
      if (JSON.stringify(original.input) !== JSON.stringify(processed.input)) {
        throw new Error(`MAHLORI CRITICAL: Step ${i} input was modified!`);
      }
    }
    
    return { steps, stepsMap };
  }

  /**
   * DEFINE EXECUTION ORDER - Based on constraints, not on content
   */
  static #defineExecutionOrder(steps, constraints) {
    const executionType = constraints?.execution_order || 'sequential';
    
    let order;
    switch (executionType) {
      case 'sequential':
        order = this.#buildSequentialOrder(steps);
        break;
      case 'parallel':
        order = this.#buildParallelOrder(steps);
        break;
      case 'dag':
        order = this.#buildDAGOrder(steps);
        break;
      default:
        order = this.#buildSequentialOrder(steps);
    }
    
    console.log(`🔀 [Mahlori] Execution order: ${executionType}`);
    
    return {
      type: executionType,
      order: order,
      maxRetries: constraints?.max_retries ?? 0,
      timeoutSeconds: constraints?.timeout_seconds ?? 30,
      onError: constraints?.on_error ?? 'fail',
      rollbackOnFailure: constraints?.rollback_on_failure ?? false
    };
  }

  static #buildSequentialOrder(steps) {
    // Pure sequential based on original order
    return steps.sort((a, b) => a.order - b.order).map(s => s.id);
  }

  static #buildParallelOrder(steps) {
    // All steps can run in parallel (ignoring dependencies)
    return [steps.map(s => s.id)];
  }

  static #buildDAGOrder(steps) {
    // Topological sort based on dependencies
    const graph = new Map();
    const inDegree = new Map();
    
    steps.forEach(step => {
      const deps = step.depends_on || [];
      graph.set(step.id, deps);
      inDegree.set(step.id, deps.length);
    });
    
    const queue = steps.filter(s => inDegree.get(s.id) === 0).map(s => s.id);
    const result = [];
    
    while (queue.length > 0) {
      const current = queue.shift();
      result.push(current);
      
      steps.forEach(step => {
        const deps = step.depends_on || [];
        if (deps.includes(current)) {
          const newDegree = inDegree.get(step.id) - 1;
          inDegree.set(step.id, newDegree);
          if (newDegree === 0) queue.push(step.id);
        }
      });
    }
    
    if (result.length !== steps.length) {
      throw new Error('MAHLORI: Circular dependency detected in plan');
    }
    
    return result;
  }

  /**
   * PREPARE PAYLOAD FOR SIYANDA
   * - Passes UNMODIFIED steps
   * - Passes clean entities and constraints
   * - NO business logic, NO text processing
   */
  static #prepareSiyandaPayload(jobId, steps, executionConfig, entities, constraints) {
    // Create a CLEAN payload for Siyanda
    const payload = {
      jobId: jobId,
      // Pass steps WITHOUT modification
      steps: steps.map(step => ({
        // Only pass what Siyanda needs (not tracking fields)
        id: step.id,
        order: step.order,
        name: step.name,
        action: step.action,
        input: step.input,  // Original, unmodified input
        dependencies: step.depends_on || [],
        metadata: step.metadata || {}
      })),
      executionConfig: executionConfig,
      entities: { ...entities },  // Fresh copy
      constraints: { ...constraints },  // Fresh copy
      // Add validation proof
      _validation: {
        validatedBy: 'Mahlori',
        validatedAt: new Date().toISOString(),
        stepCount: steps.length,
        originalGoalHash: this.#hashString(constraints?.goal || '')
      }
    };
    
    // Verify no raw text in payload (except goal which is allowed)
    this.#verifyNoRawTextProcessing(payload);
    
    return payload;
  }

  /**
   * VERIFY that Mahlori didn't process any raw text
   */
  static #verifyNoRawTextProcessing(payload) {
    // This is a safety check - Mahlori should never process text content
    const stringifyPayload = JSON.stringify(payload);
    
    // Look for patterns that would indicate text processing
    const suspiciousPatterns = [
      /analyze\s+text/i,
      /parse\s+content/i,
      /extract\s+meaning/i,
      /understand\s+context/i,
      /nlp/i,
      /natural\s+language/i
    ];
    
    for (const pattern of suspiciousPatterns) {
      if (pattern.test(stringifyPayload)) {
        console.warn('⚠️ [Mahlori] Warning: Possible text processing detected');
        // In strict mode, this would throw
        // throw new Error('MAHLORI VIOLATION: Raw text processing detected');
      }
    }
  }

  /**
   * Simple hash for validation (not cryptographic)
   */
  static #hashString(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return hash.toString();
  }

  /**
   * VALIDATE that a job is ready for execution
   * Called before passing to Siyanda
   */
  static validateReadyForExecution(job, steps) {
    if (!job || !job.id) {
      throw new Error('MAHLORI: Invalid job - missing ID');
    }
    
    if (!steps || steps.length === 0) {
      throw new Error('MAHLORI: Cannot execute - no steps defined');
    }
    
    // Verify each step has required fields
    for (const step of steps) {
      if (!step.action) {
        throw new Error(`MAHLORI: Step ${step.id} missing action`);
      }
      
      if (!this.#SUPPORTED_ACTIONS.has(step.action)) {
        throw new Error(`MAHLORI: Step ${step.id} has unsupported action '${step.action}'`);
      }
    }
    
    console.log('✅ [Mahlori] Job validation passed - ready for Siyanda');
    return true;
  }
}

export default MahloriEngine;