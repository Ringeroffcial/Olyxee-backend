import OrdoService from '../services/ordo.service.js';

class OrdoController {
  // Private static method for consistent response (only for non-spec endpoints)
  static #sendResponse(res, statusCode, data) {
    return res.status(statusCode).json({
      timestamp: new Date().toISOString(),
      ...data
    });
  }

  static async execute(req, res) {
    try {
      const { body: jsonPayload } = req;
      
      if (!jsonPayload || typeof jsonPayload !== 'object') {
        return OrdoController.#sendResponse(res, 400, {
          status: 'error',
          error: 'Invalid request body'
        });
      }
      
      const result = await OrdoService.process(jsonPayload);
      
      return OrdoController.#sendResponse(res, 200, {
        status: 'success',
        data: result
      });
      
    } catch (error) {
      console.error('❌ Execution error:', error.message);
      
      return OrdoController.#sendResponse(res, error.statusCode || 400, {
        status: 'error',
        error: error.message
      });
    }
  }

  // Status endpoint (detailed - includes progress, etc.)
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

  // RESULT endpoint - EXACTLY matches required spec (Section 5)
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
      
      // Check if job is still processing
      if (jobData.status === 'pending' || jobData.status === 'queued' || jobData.status === 'running') {
        return res.status(202).json({
          status: 'requires_action',
          decision: 'Job still processing',
          reasons: ['Workflow has not completed yet'],
          actions: ['Wait a few seconds and try again', 'Check status endpoint for progress']
        });
      }
      
      // Check if job failed or was blocked
      if (jobData.status === 'failed') {
        return res.status(200).json({
          status: 'failed',
          decision: jobData.decision || 'Workflow failed',
          reasons: jobData.reasons || [jobData.error || 'Unknown error'],
          actions: jobData.actions || ['Check logs', 'Verify inputs', 'Retry workflow']
        });
      }
      
      if (jobData.status === 'blocked') {
        return res.status(200).json({
          status: 'blocked',
          decision: jobData.decision || 'Workflow blocked',
          reasons: jobData.reasons || [jobData.blockingReason || 'Constraint violation'],
          actions: jobData.actions || ['Review constraints', 'Fix violations', 'Retry workflow']
        });
      }
      
      // Return EXACTLY the required format (no wrapper, no extra fields)
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

  // Download full result file (for archiving/audit)
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

  // Get result file path info
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

  // List all jobs (for debugging)
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

  // Get job statistics
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

  // Clear all jobs (admin only - use with caution)
  static async clearAllJobs(req, res) {
    try {
      // Optional: Add admin authentication here
      // const apiKey = req.headers['x-api-key'];
      // if (apiKey !== 'your-secret-key') {
      //   return OrdoController.#sendResponse(res, 401, {
      //     status: 'error',
      //     error: 'Unauthorized'
      //   });
      // }
      
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

  // Health check endpoint
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