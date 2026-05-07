// controllers/ordo.controller.js
import OrdoService from '../services/ordo.service.js';

class OrdoController {
  // Private static method for consistent response (only for non-spec endpoints)
  static #sendResponse(res, statusCode, data) {
    return res.status(statusCode).json({
      timestamp: new Date().toISOString(),
      ...data
    });
  }
  // Validates and queues jobs for processing
  static async execute(req, res) {
    try {
      const { body: jsonPayload } = req;
      
      // Strict input validation - reject invalid or malformed requests
      if (!jsonPayload) {
        return OrdoController.#sendResponse(res, 400, {
          status: 'error',
          error: 'Request body is required'
        });
      }
      
      // Reject raw text - only structured JSON objects are allowed
      if (typeof jsonPayload === 'string') {
        return OrdoController.#sendResponse(res, 400, {
          status: 'error',
          error: 'Raw text not allowed. Please provide structured JSON object.',
          hint: 'Request body must be a JSON object with fields: goal, plan, entities, constraints'
        });
      }
      
      // Reject arrays or other non-object types
      if (typeof jsonPayload !== 'object' || Array.isArray(jsonPayload)) {
        return OrdoController.#sendResponse(res, 400, {
          status: 'error',
          error: 'Invalid request body. Expected JSON object, got ' + (Array.isArray(jsonPayload) ? 'array' : typeof jsonPayload)
        });
      }
      
      // Delegate to OrdoService which uses Mahlori for strict validation
      const result = await OrdoService.process(jsonPayload);
      
      // Return success response with validation proof
      return OrdoController.#sendResponse(res, 200, {
        status: 'success',
        data: result,
        validatedBy: 'Mahlori',
        validationTimestamp: new Date().toISOString()
      });
      
    } catch (error) {
      console.error('❌ Execution error:', error.message);
      
      // Differentiate between validation errors (client fault) and execution errors (server fault)
      const isValidationError = error.message.includes('MAHLORI') || 
                                error.message.includes('validation') ||
                                error.message.includes('Missing required') ||
                                error.message.includes('unsupported');
      
      const statusCode = isValidationError ? 400 : 500;
      
      return OrdoController.#sendResponse(res, statusCode, {
        status: 'error',
        error: error.message
      });
    }
  }

  // Returns current state, completed steps, and any errors
  static async getJobStatus(req, res) {
    try {
      const { jobId } = req.params;
      
      if (!jobId) {
        return OrdoController.#sendResponse(res, 400, {
          status: 'error',
          error: 'Job ID is required'
        });
      }
      
      const status = await OrdoService.getJobStatus(jobId);
      
      return OrdoController.#sendResponse(res, 200, {
        status: 'success',
        data: status
      });
    } catch (error) {
      return OrdoController.#sendResponse(res, 404, {
        status: 'error',
        error: `Job ${req.params.jobId} not found`
      });
    }
  }
  // Returns final decision with reasons and actions in standardized format
  static async getJobResult(req, res) {
    try {
      const { jobId } = req.params;
      
      if (!jobId) {
        return res.status(400).json({
          status: 'failed',
          decision: 'Invalid request',
          reasons: ['Job ID is required'],
          actions: ['Provide a valid job ID']
        });
      }
      
      const jobData = await OrdoService.getJobStatus(jobId);
      
      // Job is still processing - return 202 Accepted with status info
      if (jobData.status === 'pending' || jobData.status === 'queued' || jobData.status === 'running') {
        return res.status(202).json({
          status: 'requires_action',
          decision: 'Job still processing',
          reasons: ['Workflow has not completed yet'],
          actions: ['Wait a few seconds and try again', 'Check status endpoint for progress']
        });
      }
      
      // Job failed - return failure details with remediation actions
      if (jobData.status === 'failed') {
        return res.status(200).json({
          status: 'failed',
          decision: jobData.decision || 'Workflow failed',
          reasons: jobData.reasons || [jobData.error || 'Unknown error'],
          actions: jobData.actions || ['Check logs', 'Verify inputs', 'Retry workflow']
        });
      }
      
      // Job blocked by constraints - return blocking reasons
      if (jobData.status === 'blocked') {
        return res.status(200).json({
          status: 'blocked',
          decision: jobData.decision || 'Workflow blocked',
          reasons: jobData.reasons || [jobData.blockingReason || 'Constraint violation'],
          actions: jobData.actions || ['Review constraints', 'Fix violations', 'Retry workflow']
        });
      }
      
      // Job completed successfully - return final decision in spec-compliant format
      const finalResult = {
        status: 'completed',
        decision: jobData.decision || jobData.finalDecision || 'Goal achieved',
        reasons: jobData.reasons || [],
        actions: jobData.actions || []
      };
      
      return res.status(200).json(finalResult);
      
    } catch (error) {
      return res.status(404).json({
        status: 'failed',
        decision: 'Job not found',
        reasons: [error.message || `Job ${req.params.jobId} not found`],
        actions: ['Verify job ID is correct', 'Check if job has expired', 'Contact support']
      });
    }
  }

  // Returns full JSON file with all execution details
  static async downloadResultFile(req, res) {
    try {
      const { jobId } = req.params;
      
      if (!jobId) {
        return OrdoController.#sendResponse(res, 400, {
          status: 'error',
          error: 'Job ID is required'
        });
      }
      
      const resultData = await OrdoService.readResultFromFile(jobId);
      
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename=result_${jobId}.json`);
      return res.status(200).json(resultData);
      
    } catch (error) {
      return OrdoController.#sendResponse(res, 404, {
        status: 'error',
        error: error.message
      });
    }
  }

  // FILE INFO ENDPOINT - Get result file path (for debugging)
  static async getResultFileInfo(req, res) {
    try {
      const { jobId } = req.params;
      
      if (!jobId) {
        return OrdoController.#sendResponse(res, 400, {
          status: 'error',
          error: 'Job ID is required'
        });
      }
      
      const filePath = await OrdoService.getResultFile(jobId);
      
      if (!filePath) {
        return OrdoController.#sendResponse(res, 404, {
          status: 'error',
          error: 'No result file found for this job'
        });
      }
      
      return OrdoController.#sendResponse(res, 200, {
        status: 'success',
        data: {
          jobId,
          resultFile: filePath
        }
      });
      
    } catch (error) {
      return OrdoController.#sendResponse(res, 404, {
        status: 'error',
        error: error.message
      });
    }
  }

  // Returns summary of all jobs with their current status
  static async listAllJobs(req, res) {
    try {
      const jobs = await OrdoService.getAllJobs();
      const stats = await OrdoService.getJobStats();
      
      return OrdoController.#sendResponse(res, 200, {
        status: 'success',
        data: {
          activeJobs: jobs.length,
          stats: stats,
          jobs: jobs
        }
      });
    } catch (error) {
      return OrdoController.#sendResponse(res, 500, {
        status: 'error',
        error: error.message
      });
    }
  }

  // Returns counts of jobs by status and system health info
  static async getStats(req, res) {
    try {
      const stats = await OrdoService.getJobStats();
      return OrdoController.#sendResponse(res, 200, {
        status: 'success',
        data: stats
      });
    } catch (error) {
      return OrdoController.#sendResponse(res, 500, {
        status: 'error',
        error: error.message
      });
    }
  }

  // Removes all job data from the system
  static async clearAllJobs(req, res) {
    try {
      
      await OrdoService.clearAllJobs();
      return OrdoController.#sendResponse(res, 200, {
        status: 'success',
        message: 'All jobs cleared successfully'
      });
    } catch (error) {
      return OrdoController.#sendResponse(res, 500, {
        status: 'error',
        error: error.message
      });
    }
  }

  // Returns system status and version information
  static async healthCheck(req, res) {
    return OrdoController.#sendResponse(res, 200, {
      status: 'success',
      data: {
        service: 'Ordo Workflow Engine',
        status: 'healthy',
        timestamp: new Date().toISOString(),
        version: '1.0.0'
      }
    });
  }
}

export default OrdoController;