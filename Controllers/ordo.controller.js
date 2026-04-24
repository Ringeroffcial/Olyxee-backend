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
      
      const result = await OrdoService.process(jsonPayload);
      
      return this.#sendResponse(res, 200, {
        status: 'success',
        data: result
      });
      
    } catch (error) {
      console.error('❌ Execution error:', error.message);
      
      return this.#sendResponse(res, error.statusCode || 400, {
        status: 'error',
        error: error.message
      });
    }
  }

  static async getJobStatus(req, res) {
    try {
      const { jobId } = req.params;
      const status = await OrdoService.getJobStatus(jobId);
      
      return this.#sendResponse(res, 200, {
        status: 'success',
        data: status
      });
    } catch (error) {
      return this.#sendResponse(res, 404, {
        status: 'error',
        error: `Job ${req.params.jobId} not found`
      });
    }
  }
}

export default OrdoController;