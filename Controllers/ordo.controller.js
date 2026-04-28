import OrdoService from '../services/ordo.service.js';

class OrdoController {
  // Private static method for consistent response
  static #sendResponse(res, statusCode, data) {
    return res.status(statusCode).json({
      timestamp: new Date().toISOString(),
      ...data
    });
  }

  static async execute(req, res) {
    try {
      const { body: jsonPayload } = req;
      
      // Validate request body
      if (!jsonPayload || typeof jsonPayload !== 'object') {
        return OrdoController.#sendResponse(res, 400, {
          status: 'error',
          error: 'Invalid request body'
        });
      }
      
      const result = await OrdoService.process(jsonPayload);
      
      // Return immediate acknowledgment
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

  static async getJobStatus(req, res) {
    try {
      const { jobId } = req.params;
      
      if (!jobId) {
        return OrdoController.#sendResponse(res, 400, {
          status: 'error',
          error: 'Job ID is required'
        });
      }
      
      const jobData = await OrdoService.getJobStatus(jobId);
      
      // Format to match required output spec (Section 5)
      const requiredFormat = {
        status: jobData.status === 'completed' ? 'completed' :
                jobData.status === 'blocked' ? 'blocked' :
                jobData.status === 'failed' ? 'failed' : 'requires_action',
        decision: jobData.finalDecision || jobData.decision || 'Processing',
        reasons: jobData.reasons || [],
        actions: jobData.actions || []
      };
      
      // Return in the exact required format (no wrapper)
      return res.status(200).json(requiredFormat);
      
    } catch (error) {
      // Error format also matches spec
      return res.status(404).json({
        status: 'failed',
        decision: 'Job not found',
        reasons: [`Job ${req.params.jobId} not found`],
        actions: ['Verify job ID is correct', 'Check if job has expired', 'Contact support if issue persists']
      });
    }
  }

  // New endpoint that returns ONLY the final result in required format
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
      
      // Return EXACTLY the required format
      const finalResult = {
        status: jobData.status === 'completed' ? 'completed' :
                jobData.status === 'blocked' ? 'blocked' :
                jobData.status === 'failed' ? 'failed' : 'requires_action',
        decision: jobData.finalDecision || jobData.decision || 'No decision available',
        reasons: jobData.reasons || [],
        actions: jobData.actions || []
      };
      
      return res.status(200).json(finalResult);
      
    } catch (error) {
      return res.status(404).json({
        status: 'failed',
        decision: 'Job not found',
        reasons: [error.message || `Job ${req.params.jobId} not found`],
        actions: ['Verify job ID', 'Check if job exists in system']
      });
    }
  }
}

export default OrdoController;