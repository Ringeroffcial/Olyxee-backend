import express from 'express';
import OrdoController from '../Controllers/ordo.controller.js';

const router = express.Router();

router.post('/execute', OrdoController.execute.bind(OrdoController));

router.get('/result/:jobId', OrdoController.getJobResult.bind(OrdoController));

router.get('/status/:jobId', OrdoController.getJobStatus.bind(OrdoController));

router.get('/download/:jobId', OrdoController.downloadResultFile.bind(OrdoController));

router.get('/result-file/:jobId', OrdoController.getResultFileInfo.bind(OrdoController));

router.get('/jobs', OrdoController.listAllJobs.bind(OrdoController));

router.get('/stats', OrdoController.getStats.bind(OrdoController));

router.delete('/jobs', OrdoController.clearAllJobs.bind(OrdoController));

router.get('/health', OrdoController.healthCheck.bind(OrdoController));

router.get('/job/:jobId/status', OrdoController.getJobResult.bind(OrdoController));

export default router;