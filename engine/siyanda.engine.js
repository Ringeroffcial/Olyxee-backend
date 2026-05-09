// engine/siyanda.engine.js
import ExecutionEngine from './execution.engine.js';
import DecisionEngine from './decision.engine.js';

class SiyandaEngine {
  //execution point 
  async execute(payload) {
    const {
      jobId,
      steps,
      executionConfig,
      entities,
      constraints
    } = payload;

    console.log(`🚀 [Siyanda] Starting execution for job ${jobId}`);
    console.log(`   Execution order: ${executionConfig.type}`);

    // Clone steps so we can track status without mutating original
    const stepsWithState = steps.map(step => ({
      ...step,
      status: 'pending',   // pending, running, completed, failed, blocked
      result: null,
      error: null,
      retries: 0
    }));

    // Determine execution order based on config
    const executionOrder = this.#buildExecutionOrder(executionConfig, stepsWithState);

    // Execute according to order type
    let finalStatus = 'completed';
    let finalDecision = null;
    let reasons = [];
    let actions = [];

    try {
      if (executionConfig.type === 'sequential') {
        const result = await this.#executeSequential(
          executionOrder,
          stepsWithState,
          entities,
          constraints,
          executionConfig,
          jobId
        );
        finalStatus = result.status;
        reasons = result.reasons;
        actions = result.actions;
      } else if (executionConfig.type === 'parallel') {
        const result = await this.#executeParallel(
          executionOrder,
          stepsWithState,
          entities,
          constraints,
          executionConfig,
          jobId
        );
        finalStatus = result.status;
        reasons = result.reasons;
        actions = result.actions;
      } else if (executionConfig.type === 'dag') {
        const result = await this.#executeDAG(
          executionOrder,
          stepsWithState,
          entities,
          constraints,
          executionConfig,
          jobId
        );
        finalStatus = result.status;
        reasons = result.reasons;
        actions = result.actions;
      } else {
        throw new Error(`Unknown execution type: ${executionConfig.type}`);
      }

      // Extract final decision from steps or DecisionEngine
      finalDecision = this.#extractFinalDecision(stepsWithState, finalStatus, reasons);

    } catch (error) {
      console.error(`❌ [Siyanda] Fatal execution error:`, error.message);
      finalStatus = 'failed';
      finalDecision = 'Workflow failed';
      reasons = reasons.length ? reasons : [error.message];
      actions = ['Check logs', 'Verify inputs', 'Retry workflow'];
    }

    //formatting for the desired results of the project
    return {
      status: finalStatus,
      decision: finalDecision,
      reasons: reasons,
      actions: actions,
      steps: stepsWithState.map(s => ({
        id: s.id,
        name: s.name,
        action: s.action,
        status: s.status,
        result: s.result,
        error: s.error
      })),
      jobId
    };
  }

  //execution strategies 
  async #executeSequential(order, steps, entities, constraints, config, jobId) {
    let allCompleted = true;
    const reasons = [];
    const actions = [];

    for (const stepId of order) {
      const step = steps.find(s => s.id === stepId);
      if (!step) continue;

      const result = await this.#executeSingleStep(step, entities, constraints, config, jobId);

      // Update step state
      step.status = result.status;
      step.result = result.data || null;
      step.error = result.error;

      if (result.status === 'failed') {
        allCompleted = false;
        reasons.push(`Step "${step.name}" failed: ${result.error}`);
        actions.push(`Review step ${step.name} and retry`);
        if (config.onError === 'fail') break;
      } else if (result.status === 'blocked') {
        allCompleted = false;
        reasons.push(...result.reasons);
        actions.push(...result.actions);
        break;
      } else {
        // merge any updates to entities
        if (result.updatedEntities) {
          Object.assign(entities, result.updatedEntities);
        }
      }
    }

    const status = allCompleted ? 'completed' : (steps.some(s => s.status === 'blocked') ? 'blocked' : 'failed');
    return { status, reasons, actions };
  }

  async #executeParallel(order, steps, entities, constraints, config, jobId) {
    // order is an array of arrays
    const allReasons = [];
    const allActions = [];
    let finalStatus = 'completed';

    for (const batch of order) {
      const batchResults = await Promise.all(
        batch.map(stepId => {
          const step = steps.find(s => s.id === stepId);
          return step ? this.#executeSingleStep(step, entities, constraints, config, jobId) : null;
        })
      );

      for (let i = 0; i < batch.length; i++) {
        const result = batchResults[i];
        const step = steps.find(s => s.id === batch[i]);
        if (!step) continue;

        step.status = result.status;
        step.result = result.data || null;
        step.error = result.error;

        if (result.status === 'failed') {
          finalStatus = 'failed';
          allReasons.push(`Step "${step.name}" failed: ${result.error}`);
          allActions.push(`Review step ${step.name}`);
        } else if (result.status === 'blocked') {
          finalStatus = 'blocked';
          allReasons.push(...result.reasons);
          allActions.push(...result.actions);
        } else {
          if (result.updatedEntities) Object.assign(entities, result.updatedEntities);
        }
      }

      if (finalStatus !== 'completed') break;
    }

    return { status: finalStatus, reasons: allReasons, actions: allActions };
  }

  async #executeDAG(order, steps, entities, constraints, config, jobId) {
    // order is a topological sorted list of step IDs
    // For DAG we execute in order but we also need to honour dependencies (already sorted)
    return this.#executeSequential(order, steps, entities, constraints, config, jobId);
  }

  //single step execution with retries and branching
  async #executeSingleStep(step, entities, constraints, config, jobId) {
    const maxRetries = config.maxRetries ?? 0;
    let attempt = 0;
    let lastError = null;

    while (attempt <= maxRetries) {
      try {
        console.log(`🔧 [Siyanda] Executing step: ${step.name} (${step.action}) attempt ${attempt + 1}`);
        
        // Apply constraint validation before step
        this.#validateStepConstraints(step, constraints);

        // Route to appropriate handler and it includes ExecutionEngine & DecisionEngine
        const result = await this.#routeAction(step.action, step.input, entities, jobId);
        
        return {
          status: 'completed',
          data: result.data !== undefined ? result.data : result,
          error: null,
          updatedEntities: result.updatedEntities || null
        };
      } catch (error) {
        lastError = error;
        const isRetryable = error.retryable !== false && attempt < maxRetries;
        
        if (isRetryable) {
          console.warn(`⚠️ Retry ${attempt + 1}/${maxRetries} for step ${step.name}`);
          attempt++;
          await this.#delay(1000 * attempt); // exponential backoff not required but nice
        } else {
          // Determine if it's a blocking error
          const isBlocking = error.type === 'blocked' || (error.reason && error.reason.includes('constraint'));
          return {
            status: isBlocking ? 'blocked' : 'failed',
            data: null,
            error: error.message,
            reasons: error.violations || [error.reason || error.message],
            actions: error.actions || ['Check constraints', 'Fix data and retry']
          };
        }
      }
    }

    return {
      status: 'failed',
      data: null,
      error: lastError.message,
      reasons: [lastError.message],
      actions: ['Maximum retries exceeded', 'Investigate step failure']
    };
  }

  //==Routing to handlers and intergrates ExecutionEngine & DecisionEngine==
  
  async #routeAction(action, input, entities, jobId) {
    // Business-specific actions – delegate to your existing engines
    if (action === 'fetch_provider_profile') {
      const result = await ExecutionEngine.executeStep({ action, input }, entities);
      return { data: result, updatedEntities: { providerProfile: result } };
    }
    if (action === 'fetch_compliance_documents') {
      const result = await ExecutionEngine.executeStep({ action, input }, entities);
      return { data: result, updatedEntities: { complianceDocs: result } };
    }
    if (action === 'generate_final_decision') {
      const decision = DecisionEngine.generateDecisions(entities);
      return {
        data: decision,
        updatedEntities: { finalDecision: decision },
        decisionStatus: decision.status,
        decisionOutcome: decision.decision,
        reasons: decision.reasons,
        actions: decision.actions
      };
    }

    // Generic actions (log, calculate, wait, etc.)
    switch (action) {
      case 'log':
        return { data: this.#handleLog(input) };
      case 'calculate':
        return { data: this.#handleCalculationSafe(input) };
      case 'transform_data':
        return this.#handleTransformData(input, entities);
      case 'wait':
        await this.#handleWait(input);
        return { data: { waited: true } };
      case 'validate_compliance':
        return { data: this.#handleComplianceCheck(input, entities) };
      case 'branch':
        return await this.#handleBranchCondition(input, entities);
      case 'send_notification':
        return { data: await this.#handleNotification(input, jobId) };
      case 'update_status':
        return { data: this.#handleStatusUpdate(input) };
      case 'mock_api_call':
        return { data: await this.#handleMockApiCall(input) };
      case 'webhook':
        return { data: await this.#handleWebhook(input) };
      default:
        // If action not recognized, try to delegate to ExecutionEngine as fallback
        const fallback = await ExecutionEngine.executeStep({ action, input }, entities);
        return { data: fallback };
    }
  }

  //Safe Handler
  #handleLog(input) {
    const { message, level = 'info' } = input;
    console.log(`[${level.toUpperCase()}] ${message}`);
    return { logged: true, message, level };
  }

  #handleCalculationSafe(input) {
    const { operation, a, b } = input;
    const ops = {
      add: (x, y) => x + y,
      subtract: (x, y) => x - y,
      multiply: (x, y) => x * y,
      divide: (x, y) => (y !== 0 ? x / y : null),
      modulus: (x, y) => x % y,
      power: (x, y) => Math.pow(x, y)
    };
    if (!ops[operation]) throw new Error(`Unsupported operation: ${operation}`);
    const result = ops[operation](a, b);
    if (result === null) throw new Error('Division by zero');
    return { operation, input: { a, b }, result };
  }

  #handleTransformData(input, entities) {
    const { source, transform, target } = input;
    let sourceData = source === 'entities' ? entities : source;
    let result = { ...sourceData };
    if (transform === 'uppercase' && sourceData.text) result.text = sourceData.text.toUpperCase();
    else if (transform === 'lowercase' && sourceData.text) result.text = sourceData.text.toLowerCase();
    else if (transform === 'merge' && input.mergeWith) result = { ...sourceData, ...input.mergeWith };
    else if (transform === 'extract' && input.fields) {
      const extracted = {};
      input.fields.forEach(field => { extracted[field] = sourceData[field]; });
      result = extracted;
    }
    return { data: result, updatedEntities: target ? { [target]: result } : null };
  }

  async #handleWait(input) {
    const durationMs = input.durationMs || input.durationSec * 1000 || 1000;
    await new Promise(resolve => setTimeout(resolve, durationMs));
  }

  #handleComplianceCheck(input, entities) {
    const { rules, data_path, expected_value } = input;
    let dataToCheck = data_path ? this.#getNestedValue(entities, data_path) : entities;
    const violations = [];
    for (const rule of (rules || [])) {
      const actual = this.#getNestedValue(dataToCheck, rule.field);
      const compliant = this.#evaluateOperator(actual, rule.operator, rule.value);
      if (!compliant) {
        violations.push({ rule: rule.name, field: rule.field, expected: rule.value, actual, operator: rule.operator });
      }
    }
    if (violations.length) {
      throw { type: 'blocked', reason: 'Compliance check failed', violations, retryable: false };
    }
    return { compliant: true, checked: rules?.length || 0 };
  }

  async #handleBranchCondition(input, entities) {
    const { condition, true_branch, false_branch } = input;
    const conditionMet = this.#evaluateCondition(condition, entities);
    if (conditionMet && true_branch) {
      const branchResult = await this.#routeAction(true_branch.action, true_branch.input, entities);
      return { data: branchResult.data, branch: 'true' };
    } else if (!conditionMet && false_branch) {
      const branchResult = await this.#routeAction(false_branch.action, false_branch.input, entities);
      return { data: branchResult.data, branch: 'false' };
    }
    return { data: { conditionMet, branch: conditionMet ? 'true' : 'false' } };
  }

  async #handleNotification(input, jobId) {
    const { type, recipient, message, channel = 'console' } = input;
    if (channel === 'console') console.log(`📢 [NOTIFICATION] [${type}] ${message} ${recipient ? `To: ${recipient}` : ''}`);
    else if (channel === 'email') console.log(`📧 [EMAIL] To: ${recipient}\n   Subject: ${type}\n   Body: ${message}`);
    else if (channel === 'webhook') console.log(`🔗 [WEBHOOK] Call ${recipient}\n   Payload: ${JSON.stringify({ type, message, jobId })}`);
    return { sent: true, channel, recipient, message };
  }

  #handleStatusUpdate(input) {
    const { entity_type, entity_id, status, metadata = {} } = input;
    console.log(`📝 [STATUS UPDATE] ${entity_type}/${entity_id} -> ${status}`);
    return { updated: true, entity_type, entity_id, status, metadata };
  }

  async #handleMockApiCall(input) {
    const { url, method = 'GET', response_delay = 100, mock_response, status_code = 200 } = input;
    console.log(`🎭 [MOCK API] ${method} ${url}`);
    if (response_delay) await this.#delay(response_delay);
    if (status_code >= 400) throw { type: 'failed', reason: `API returned ${status_code}`, retryable: status_code >= 500 };
    return { status: status_code, data: mock_response || { message: `Mock response for ${url}` }, headers: { 'content-type': 'application/json' } };
  }

  async #handleWebhook(input) {
    const { url, method = 'POST', payload } = input;
    console.log(`🔗 [WEBHOOK] ${method} ${url}\n   Payload:`, payload);
    return { called: true, url, method, payload, response: { status: 200, message: 'Webhook would be called here' } };
  }

  //Helper Methods
  #evaluateCondition(condition, entities) {
    if (!condition) return false;
    const { field, operator, value, logical = 'AND', conditions } = condition;
    if (field && operator) {
      const actual = this.#getNestedValue(entities, field);
      return this.#evaluateOperator(actual, operator, value);
    }
    if (conditions && Array.isArray(conditions)) {
      const results = conditions.map(c => this.#evaluateCondition(c, entities));
      return logical === 'AND' ? results.every(r => r) : results.some(r => r);
    }
    return false;
  }

  #evaluateOperator(actual, operator, expected) {
    const ops = {
      eq: (a, e) => a == e,
      neq: (a, e) => a != e,
      gt: (a, e) => a > e,
      gte: (a, e) => a >= e,
      lt: (a, e) => a < e,
      lte: (a, e) => a <= e,
      contains: (a, e) => String(a).includes(e),
      startsWith: (a, e) => String(a).startsWith(e),
      endsWith: (a, e) => String(a).endsWith(e),
      in: (a, e) => Array.isArray(e) && e.includes(a),
      exists: a => a !== undefined && a !== null,
      empty: a => !a || (Array.isArray(a) && a.length === 0) || (typeof a === 'object' && Object.keys(a).length === 0)
    };
    const fn = ops[operator];
    return fn ? fn(actual, expected) : actual == expected;
  }

  #getNestedValue(obj, path) {
    if (!path) return obj;
    return path.split('.').reduce((curr, key) => curr?.[key], obj);
  }

  #validateStepConstraints(step, constraints) {
    if (!constraints) return;
    if (constraints.blocked_actions?.includes(step.action)) {
      throw { type: 'blocked', reason: `Action '${step.action}' is blocked`, retryable: false };
    }
    if (constraints.required_fields?.[step.action]) {
      const missing = constraints.required_fields[step.action].filter(f => !step.input?.[f]);
      if (missing.length) {
        throw { type: 'failed', reason: `Missing required fields: ${missing.join(', ')}`, retryable: true };
      }
    }
  }

  #buildExecutionOrder(config, steps) {
    if (config.type === 'sequential') {
      return config.order; // already an array of step IDs
    } else if (config.type === 'parallel') {
      // config.order is an array of arrays
      return config.order;
    } else if (config.type === 'dag') {
      return config.order;
    }
    return steps.map(s => s.id);
  }

  #extractFinalDecision(steps, finalStatus, reasons) {
    // Look for a step that generated a decision
    const decisionStep = steps.find(s => s.action === 'generate_final_decision' && s.result);
    if (decisionStep && decisionStep.result.decision) {
      return decisionStep.result.decision;
    }
    // Fallback based on status
    if (finalStatus === 'completed') return 'Goal achieved';
    if (finalStatus === 'blocked') return 'Workflow blocked';
    return 'Workflow failed';
  }

  #delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

export default new SiyandaEngine();
