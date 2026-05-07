// services/ordo.service.js
import { v4 as uuidv4 } from 'uuid';
import EventEmitter from 'events';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import MahloriEngine from '../engine/mahlori.engine.js';
import SiyandaEngine from '../engine/siyanda.engine.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Persistent Job Store with file-based storage
class JobStore {
  #jobs = new Map();
  #persistFile = path.join(__dirname, '../data/jobs.json');
  #saveTimeout = null;
  
  constructor() {
    this.#loadFromDisk();
  }
  
  async #loadFromDisk() {
    try {
      const data = await fs.readFile(this.#persistFile, 'utf8');
      const jobs = JSON.parse(data);
      jobs.forEach(job => {
        // Reconstruct Map for stepsMap if needed
        if (job.stepsMap) {
          job.stepsMap = new Map(Object.entries(job.stepsMap));
        }
        this.#jobs.set(job.id, job);
      });
      console.log(`📀 Loaded ${jobs.length} jobs from disk`);
    } catch (error) {
      console.log('📀 No existing jobs file found, starting fresh');
    }
  }
  
  async #saveToDisk() {
    if (this.#saveTimeout) {
      clearTimeout(this.#saveTimeout);
    }
    
    this.#saveTimeout = setTimeout(async () => {
      try {
        const jobs = Array.from(this.#jobs.values()).map(job => {
          const copy = { ...job };
          if (copy.stepsMap) {
            copy.stepsMap = Object.fromEntries(copy.stepsMap);
          }
          return copy;
        });
        const dir = path.dirname(this.#persistFile);
        await fs.mkdir(dir, { recursive: true });
        await fs.writeFile(this.#persistFile, JSON.stringify(jobs, null, 2));
        console.log(`💾 Saved ${jobs.length} jobs to disk`);
      } catch (error) {
        console.error('Failed to save jobs to disk:', error.message);
      }
    }, 500);
  }
  
  set(jobId, jobData) {
    this.#jobs.set(jobId, jobData);
    this.#saveToDisk();
  }
  
  get(jobId) {
    return this.#jobs.get(jobId);
  }
  
  update(jobId, updates) {
    const existing = this.#jobs.get(jobId);
    if (existing) {
      const updated = { ...existing, ...updates };
      this.#jobs.set(jobId, updated);
      this.#saveToDisk();
      return updated;
    }
    return null;
  }
  
  has(jobId) {
    return this.#jobs.has(jobId);
  }
  
  delete(jobId) {
    const deleted = this.#jobs.delete(jobId);
    this.#saveToDisk();
    return deleted;
  }
  
  getAll() {
    return Array.from(this.#jobs.values());
  }
  
  getStats() {
    const jobs = this.getAll();
    return {
      totalJobs: jobs.length,
      completed: jobs.filter(j => j.status === 'completed').length,
      failed: jobs.filter(j => j.status === 'failed').length,
      blocked: jobs.filter(j => j.status === 'blocked').length,
      running: jobs.filter(j => j.status === 'running').length,
      pending: jobs.filter(j => j.status === 'pending').length,
      requiresAction: jobs.filter(j => j.status === 'requires_action').length
    };
  }
  
  async clearAll() {
    this.#jobs.clear();
    await this.#saveToDisk();
    console.log('🗑️ All jobs cleared from storage');
  }
}

class OrdoService {
  #jobStore = new JobStore();
  #eventEmitter = new EventEmitter();

  /**
   * MAIN PROCESS METHOD
   * Now properly delegates to Mahlori for entry logic
   */
  async process(payload) {
    console.log('📥 [Ordo] Received payload for processing');
    
    try {
      // STEP 1: Let Mahlori handle ALL entry responsibilities
      const {
        job: jobMetadata,
        steps,
        stepsMap,
        executionConfig,
        siyandaPayload
      } = MahloriEngine.process(payload);
      
      // STEP 2: Store complete job data
      const fullJob = {
        ...jobMetadata,
        steps: steps,
        stepsMap: stepsMap,
        executionConfig: executionConfig,
        entities: payload.entities,
        constraints: payload.constraints,
        status: 'queued',
        progress: 0,
        completedSteps: 0,
        failedSteps: 0,
        blockedSteps: 0,
        result: null,
        finalDecision: null,
        decision: null,
        reasons: [],
        actions: [],
        resultFile: null,
        error: null,
        blockingReason: null
      };
      
      this.#jobStore.set(jobMetadata.id, fullJob);
      
      // STEP 3: Validate that job is ready for Siyanda
      MahloriEngine.validateReadyForExecution(fullJob, steps);
      
      // STEP 4: Pass to Siyanda for execution (async, don't block response)
      this.#executeWithSiyanda(jobMetadata.id, siyandaPayload).catch(error => {
        console.error(`[Ordo] Async execution error for job ${jobMetadata.id}:`, error);
      });
      
      console.log(`✅ [Ordo] Job ${jobMetadata.id} queued successfully`);
      
      // Return acknowledgment (don't wait for completion)
      return {
        jobId: jobMetadata.id,
        goal: payload.goal,
        totalSteps: steps.length,
        executionOrder: executionConfig.type,
        status: 'queued',
        timestamp: new Date().toISOString(),
        validatedBy: 'Mahlori',
        message: 'Job accepted and queued for execution'
      };
      
    } catch (error) {
      console.error(`❌ [Ordo] Processing failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Execute job using Siyanda Engine
   * Ordo only orchestrates - doesn't modify business logic
   */
  async #executeWithSiyanda(jobId, siyandaPayload) {
    const job = this.#jobStore.get(jobId);
    if (!job) {
      console.error(`[Ordo] Job ${jobId} not found during execution`);
      return;
    }
    
    job.status = 'running';
    job.updatedAt = new Date().toISOString();
    this.#jobStore.update(jobId, { status: 'running', updatedAt: job.updatedAt });
    
    console.log(`🚀 [Ordo] Passing job ${jobId} to Siyanda for execution`);
    console.log(`📋 [Ordo] Siyanda payload:`, JSON.stringify(siyandaPayload, null, 2).substring(0, 200) + '...');
    
    try {
      // Siyanda handles ALL execution logic
      const executionResult = await SiyandaEngine.execute(siyandaPayload);
      
      // Update job with results
      const finalStatus = this.#determineFinalStatus(executionResult);
      
      const completedSteps = job.steps?.filter(s => s.status === 'completed').length || 0;
      const failedSteps = job.steps?.filter(s => s.status === 'failed').length || 0;
      const blockedSteps = job.steps?.filter(s => s.status === 'blocked').length || 0;
      
      this.#jobStore.update(jobId, {
        status: finalStatus.status,
        progress: 100,
        completedSteps: completedSteps,
        failedSteps: failedSteps,
        blockedSteps: blockedSteps,
        result: executionResult,
        finalDecision: finalStatus.decision,
        decision: finalStatus.decision,
        reasons: finalStatus.reasons,
        actions: finalStatus.actions,
        completedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
      
      // Save audit file
      await this.#saveAuditFile(jobId, executionResult);
      
      console.log(`✅ [Ordo] Job ${jobId} completed: ${finalStatus.status}`);
      console.log(`📊 [Ordo] Decision: ${finalStatus.decision}`);
      
      // Emit completion event
      this.#eventEmitter.emit('jobCompleted', {
        jobId,
        status: finalStatus.status,
        decision: finalStatus.decision,
        resultFile: this.#jobStore.get(jobId)?.resultFile
      });
      
    } catch (error) {
      console.error(`❌ [Ordo] Job ${jobId} execution failed:`, error);
      
      this.#jobStore.update(jobId, {
        status: 'failed',
        error: error.message,
        decision: 'failed',
        finalDecision: 'Workflow failed',
        reasons: [error.message],
        actions: ['Check logs', 'Verify inputs', 'Retry workflow'],
        completedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
      
      // Emit failure event
      this.#eventEmitter.emit('jobFailed', {
        jobId,
        error: error.message
      });
    }
  }

  /**
   * Determine final status from Siyanda execution result
   */
  #determineFinalStatus(executionResult) {
    // Check for blocked status
    if (executionResult.status === 'blocked' || executionResult.decision === 'blocked') {
      return {
        status: 'blocked',
        decision: executionResult.decision || 'blocked',
        reasons: executionResult.reasons || executionResult.blockers || ['Workflow blocked due to constraint violations'],
        actions: executionResult.actions || ['Review constraints', 'Fix violations', 'Retry workflow']
      };
    }
    
    // Check for failed status
    if (executionResult.status === 'failed' || executionResult.errors?.length > 0) {
      return {
        status: 'failed',
        decision: 'failed',
        reasons: executionResult.errors || ['Execution failed'],
        actions: ['Check logs', 'Verify inputs', 'Retry workflow']
      };
    }
    
    // Check for requires_action
    if (executionResult.status === 'requires_action') {
      return {
        status: 'requires_action',
        decision: executionResult.decision || 'Manual intervention required',
        reasons: executionResult.reasons || ['Manual action required'],
        actions: executionResult.actions || ['Review and take required action']
      };
    }
    
    // Default: completed successfully
    return {
      status: 'completed',
      decision: executionResult.decision || 'Goal achieved successfully',
      reasons: executionResult.reasons || ['All steps executed successfully'],
      actions: executionResult.actions || ['Workflow complete']
    };
  }

  /**
   * Save audit file for completed job
   */
  async #saveAuditFile(jobId, result) {
    try {
      const resultsDir = path.join(__dirname, '../results');
      await fs.mkdir(resultsDir, { recursive: true });
      
      const job = this.#jobStore.get(jobId);
      if (!job) {
        console.error(`[Ordo] Cannot save audit file - job ${jobId} not found`);
        return;
      }
      
      const auditData = {
        metadata: {
          jobId: jobId,
          goal: job.goal,
          validatedBy: 'Mahlori',
          executedBy: 'Siyanda',
          createdAt: job.createdAt,
          completedAt: new Date().toISOString(),
          status: job.status
        },
        executionResult: result,
        steps: job.steps?.map(step => ({
          id: step.id,
          name: step.name,
          action: step.action,
          status: step.status,
          result: step.result,
          error: step.error
        })),
        timestamp: new Date().toISOString()
      };
      
      const filepath = path.join(resultsDir, `result_${jobId}.json`);
      await fs.writeFile(filepath, JSON.stringify(auditData, null, 2));
      
      this.#jobStore.update(jobId, { resultFile: filepath });
      console.log(`💾 [Ordo] Audit file saved: ${filepath}`);
      
    } catch (error) {
      console.error('[Ordo] Failed to save audit file:', error.message);
    }
  }

  // ========== PUBLIC API METHODS ==========

  /**
   * Get job status
   */
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
      failedSteps: job.failedSteps ?? 0,
      blockedSteps: job.blockedSteps ?? 0,
      result: job.result,
      finalDecision: job.finalDecision,
      decision: job.decision,
      reasons: job.reasons,
      actions: job.actions,
      resultFile: job.resultFile,
      error: job.error,
      blockingReason: job.blockingReason,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      completedAt: job.completedAt
    };
  }

  /**
   * Get all jobs (summary)
   */
  async getAllJobs() {
    return this.#jobStore.getAll().map(job => ({
      jobId: job.id,
      goal: job.goal,
      status: job.status,
      progress: job.progress,
      totalSteps: job.steps?.length ?? 0,
      completedSteps: job.completedSteps ?? 0,
      resultFile: job.resultFile,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      completedAt: job.completedAt
    }));
  }

  /**
   * Get job statistics
   */
  async getJobStats() {
    const stats = this.#jobStore.getStats();
    const memoryUsage = process.memoryUsage();
    
    return {
      ...stats,
      memoryUsage: {
        heapUsed: `${(memoryUsage.heapUsed / 1024 / 1024).toFixed(2)} MB`,
        heapTotal: `${(memoryUsage.heapTotal / 1024 / 1024).toFixed(2)} MB`
      },
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Clear all jobs (admin only)
   */
  async clearAllJobs() {
    await this.#jobStore.clearAll();
    console.log('[Ordo] All jobs cleared');
  }

  /**
   * Get result file path
   */
  async getResultFile(jobId) {
    const job = this.#jobStore.get(jobId);
    if (!job) {
      throw new Error('Job not found');
    }
    return job.resultFile;
  }

  /**
   * Read result from file
   */
  async readResultFromFile(jobId) {
    const filePath = await this.getResultFile(jobId);
    if (!filePath) {
      throw new Error('No result file found for this job');
    }
    
    try {
      const data = await fs.readFile(filePath, 'utf8');
      return JSON.parse(data);
    } catch (error) {
      throw new Error(`Failed to read result file: ${error.message}`);
    }
  }

  /**
   * Cleanup old jobs
   */
  async cleanup(maxAgeHours = 24) {
    const jobs = this.#jobStore.getAll();
    const now = new Date();
    let cleaned = 0;
    
    for (const job of jobs) {
      const referenceDate = job.completedAt || job.createdAt;
      const age = (now - new Date(referenceDate)) / (1000 * 60 * 60);
      if (age > maxAgeHours) {
        this.#jobStore.delete(job.id);
        cleaned++;
      }
    }
    
    console.log(`🧹 [Ordo] Cleaned up ${cleaned} old jobs (older than ${maxAgeHours} hours)`);
    return cleaned;
  }

  /**
   * Event handlers
   */
  on(event, callback) {
    this.#eventEmitter.on(event, callback);
  }
  
  off(event, callback) {
    this.#eventEmitter.off(event, callback);
  }
  
  once(event, callback) {
    this.#eventEmitter.once(event, callback);
  }
}

export default new OrdoService();