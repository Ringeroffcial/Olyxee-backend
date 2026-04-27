// engine/siyanda.engine.js
class SiyandaEngine {
  // Main execution handler (no database needed)
  async executeStep(step, entities, constraints, config, jobId, attempt = 1) {
    const { action, input } = step;
    
    console.log(`🔧 [Siyanda] Executing: ${action} for job ${jobId} (attempt ${attempt})`);
    try {
      // Apply constraints first
      this.#validateConstraints(action, input, constraints);
      
      // Route to appropriate handler based on action type (no DB)
      const result = await this.#routeAction(action, input, entities, jobId);
      
      // Return standardized output
      return {
        success: true,
        data: result,
        requiresAction: result.requiresAction || false,
        metadata: {
          action,
          executedBy: 'Siyanda',
          timestamp: new Date().toISOString(),
          jobId,
          attempt
        }
      };
      
    } catch (error) {
      console.error(`❌ [Siyanda] Error in step ${step.name}:`, error.message);
      
      // Handle branching (if/else logic)
      if (error.type === 'branch_required') {
        return this.#handleBranching(error, step, entities, jobId);
      }
      
      throw error;
    }
  }
  
  // Route different action types to handlers (no DB)
  async #routeAction(action, input, entities, jobId) {
    const handlers = {
      // Simple actions (no external dependencies)
      'log': () => this.#handleLog(input),
      'calculate': () => this.#handleCalculation(input),
      'transform_data': () => this.#handleTransformData(input, entities),
      'wait': () => this.#handleWait(input),
      'validate_compliance': () => this.#handleComplianceCheck(input, entities),
      'branch': () => this.#handleBranchCondition(input, entities),
      'send_notification': () => this.#handleNotification(input, jobId),
      'update_status': () => this.#handleStatusUpdate(input),
      'mock_api_call': () => this.#handleMockApiCall(input),
      'webhook': () => this.#handleWebhook(input),
      
      // Default handler
      'default': () => ({ 
        message: `Action '${action}' executed successfully`, 
        input,
        note: 'No specific handler implemented - using default'
      })
    };
    
    const handler = handlers[action] || handlers.default;
    return await handler();
  }
  
  // ========== ACTION HANDLERS (No DB) ==========
  
  // Simple logging
  #handleLog(input) {
    const { message, level = 'info' } = input;
    console.log(`[${level.toUpperCase()}] ${message}`);
    return { logged: true, message, level };
  }
  
  // Mathematical calculations
  #handleCalculation(input) {
    const { operation, a, b, expression } = input;
    
    let result;
    if (expression) {
      // Safe evaluation (in production, use a proper expression parser)
      result = Function('"use strict";return (' + expression + ')')();
    } else {
      const operations = {
        'add': (x, y) => x + y,
        'subtract': (x, y) => x - y,
        'multiply': (x, y) => x * y,
        'divide': (x, y) => y !== 0 ? x / y : null,
        'modulus': (x, y) => x % y,
        'power': (x, y) => Math.pow(x, y)
      };
      
      const op = operations[operation];
      if (!op) throw new Error(`Unsupported operation: ${operation}`);
      
      result = op(a, b);
    }
    
    return { operation, input: { a, b }, result };
  }
  
  // Transform data
  #handleTransformData(input, entities) {
    const { source, transform, target } = input;
    
    // Get source data
    let sourceData = source === 'entities' ? entities : source;
    
    // Apply transformations
    let result = { ...sourceData };
    
    if (transform === 'uppercase' && sourceData.text) {
      result.text = sourceData.text.toUpperCase();
    } else if (transform === 'lowercase' && sourceData.text) {
      result.text = sourceData.text.toLowerCase();
    } else if (transform === 'merge' && input.mergeWith) {
      result = { ...sourceData, ...input.mergeWith };
    } else if (transform === 'extract' && input.fields) {
      const extracted = {};
      input.fields.forEach(field => {
        extracted[field] = sourceData[field];
      });
      result = extracted;
    }
    
    return {
      transformed: true,
      transform,
      data: result,
      updatedEntities: target ? { [target]: result } : null
    };
  }
  
  // Wait/Delay
  async #handleWait(input) {
    const { durationMs, durationSec } = input;
    const waitTime = durationMs || (durationSec * 1000) || 1000;
    
    console.log(`⏳ Waiting for ${waitTime}ms...`);
    await new Promise(resolve => setTimeout(resolve, waitTime));
    
    return { waited: true, durationMs: waitTime };
  }
  
  // Compliance checking (no external DB)
  #handleComplianceCheck(input, entities) {
    const { rules, data_path, expected_value } = input;
    
    // Extract data from entities or input
    let dataToCheck = entities;
    if (data_path) {
      dataToCheck = this.#getNestedValue(entities, data_path);
    }
    
    // Apply compliance rules
    const violations = [];
    
    for (const rule of (rules || [])) {
      const actualValue = this.#getNestedValue(dataToCheck, rule.field);
      const isCompliant = this.#evaluateOperator(actualValue, rule.operator, rule.value);
      
      if (!isCompliant) {
        violations.push({
          rule: rule.name || 'unnamed_rule',
          field: rule.field,
          expected: rule.value,
          actual: actualValue,
          operator: rule.operator
        });
      }
    }
    
    if (violations.length > 0) {
      throw {
        type: 'blocked',
        reason: 'Compliance check failed',
        violations,
        retryable: false
      };
    }
    
    return { 
      compliant: true, 
      checked: (rules?.length || 0),
      message: 'All compliance checks passed'
    };
  }
  
  // Branch condition evaluation
  async #handleBranchCondition(input, entities) {
    const { condition, true_branch, false_branch } = input;
    
    // Evaluate condition
    const conditionMet = this.#evaluateCondition(condition, entities);
    
    if (conditionMet && true_branch) {
      console.log(`🌿 Branch: Taking TRUE branch`);
      return await this.#routeAction(true_branch.action, true_branch.input, entities);
    } else if (!conditionMet && false_branch) {
      console.log(`🌿 Branch: Taking FALSE branch`);
      return await this.#routeAction(false_branch.action, false_branch.input, entities);
    }
    
    return {
      conditionMet,
      branch: conditionMet ? 'true' : 'false',
      message: `Condition evaluated to ${conditionMet}`
    };
  }
  
  // Notifications (console, email mock, webhook)
  async #handleNotification(input, jobId) {
    const { type, recipient, message, channel = 'console' } = input;
    
    if (channel === 'console') {
      console.log(`📢 [NOTIFICATION] [${type}] ${message}`);
      if (recipient) console.log(`   Recipient: ${recipient}`);
    } else if (channel === 'email') {
      // Mock email - just log it
      console.log(`📧 [EMAIL] To: ${recipient}`);
      console.log(`   Subject: ${type}`);
      console.log(`   Body: ${message}`);
    } else if (channel === 'webhook') {
      // Mock webhook call
      console.log(`🔗 [WEBHOOK] Calling ${recipient}`);
      console.log(`   Payload: ${JSON.stringify({ type, message, jobId })}`);
    }
    
    return { 
      sent: true, 
      channel, 
      recipient,
      message,
      timestamp: new Date().toISOString()
    };
  }
  
  // Status update (no DB - just in memory)
  #handleStatusUpdate(input) {
    const { entity_type, entity_id, status, metadata = {} } = input;
    
    console.log(`📝 [STATUS UPDATE] ${entity_type}/${entity_id} -> ${status}`);
    if (Object.keys(metadata).length > 0) {
      console.log(`   Metadata:`, metadata);
    }
    
    return {
      updated: true,
      entity_type,
      entity_id,
      status,
      metadata,
      timestamp: new Date().toISOString()
    };
  }
  
  // Mock API call (simulates external API without actual network)
  async #handleMockApiCall(input) {
    const { url, method = 'GET', response_delay = 100, mock_response, status_code = 200 } = input;
    
    console.log(`🎭 [MOCK API] ${method} ${url} (delay: ${response_delay}ms)`);
    
    // Simulate network delay
    if (response_delay > 0) {
      await new Promise(resolve => setTimeout(resolve, response_delay));
    }
    
    // Return mock response
    const response = {
      status: status_code,
      data: mock_response || {
        message: `Mock response for ${url}`,
        timestamp: new Date().toISOString()
      },
      headers: {
        'content-type': 'application/json',
        'x-mock-response': 'true'
      }
    };
    
    // Simulate error for non-200 status
    if (status_code >= 400) {
      throw {
        type: 'failed',
        reason: `API returned ${status_code}`,
        response,
        retryable: status_code >= 500
      };
    }
    
    return response;
  }
  
  // Webhook caller
  async #handleWebhook(input) {
    const { url, method = 'POST', payload, headers = {} } = input;
    
    console.log(`🔗 [WEBHOOK] ${method} ${url}`);
    console.log(`   Payload:`, payload);
    
    // In a real implementation, you'd use fetch/axios here
    // For now, just log and return mock response
    return {
      called: true,
      url,
      method,
      payload,
      response: {
        status: 200,
        message: 'Webhook would be called here (no HTTP client configured)'
      }
    };
  }
  
  // ========== HELPER METHODS ==========
  
  #evaluateCondition(condition, entities) {
    if (!condition) return false;
    
    const { field, operator, value, logical = 'AND', conditions } = condition;
    
    // Simple condition
    if (field && operator) {
      const actualValue = this.#getNestedValue(entities, field);
      return this.#evaluateOperator(actualValue, operator, value);
    }
    
    // Compound conditions
    if (conditions && Array.isArray(conditions)) {
      const results = conditions.map(cond => this.#evaluateCondition(cond, entities));
      
      if (logical === 'AND') {
        return results.every(r => r === true);
      } else if (logical === 'OR') {
        return results.some(r => r === true);
      }
    }
    
    return false;
  }
  
  #evaluateOperator(actual, operator, expected) {
    const operators = {
      'eq': (a, e) => a == e,
      'neq': (a, e) => a != e,
      'gt': (a, e) => a > e,
      'gte': (a, e) => a >= e,
      'lt': (a, e) => a < e,
      'lte': (a, e) => a <= e,
      'contains': (a, e) => String(a).includes(e),
      'startsWith': (a, e) => String(a).startsWith(e),
      'endsWith': (a, e) => String(a).endsWith(e),
      'in': (a, e) => Array.isArray(e) && e.includes(a),
      'exists': (a) => a !== undefined && a !== null,
      'empty': (a) => !a || (Array.isArray(a) && a.length === 0) || (typeof a === 'object' && Object.keys(a).length === 0)
    };
    
    const operatorFn = operators[operator];
    if (!operatorFn) {
      console.warn(`Unknown operator: ${operator}, defaulting to eq`);
      return actual == expected;
    }
    
    return operatorFn(actual, expected);
  }
  
  #getNestedValue(obj, path) {
    if (!path) return obj;
    return path.split('.').reduce((curr, key) => curr?.[key], obj);
  }
  
  #validateConstraints(action, input, constraints) {
    if (!constraints) return true;
    
    // Apply global constraints
    if (constraints.blocked_actions?.includes(action)) {
      throw {
        type: 'blocked',
        reason: `Action '${action}' is blocked by constraints`,
        retryable: false
      };
    }
    
    // Check required fields
    if (constraints.required_fields?.[action]) {
      const missing = constraints.required_fields[action].filter(
        field => !input[field]
      );
      
      if (missing.length > 0) {
        throw {
          type: 'failed',
          reason: `Missing required fields: ${missing.join(', ')}`,
          missing,
          retryable: true
        };
      }
    }
    
    return true;
  }
  
  #handleBranching(error, step, entities, jobId) {
    throw error;
  }
}

export default new SiyandaEngine();