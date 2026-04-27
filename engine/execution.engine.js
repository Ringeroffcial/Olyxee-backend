class ExecutionEngine{
    static async executeStep(step, entities) {

        console.log(`⚙️  ExecutionEngine processing: ${step.action}`);

        switch(step.action) {
            case "fetch_provider_profile":
                return{
                    providerName: entities.providerName,
                    region: entities.region,
                    type: entities.providerType
                };

            case "fetch_compliance_documents":
                return{
                    bbbeeLevel: entities.bbbeeLevel,
                    bbbeeExpiry: entities.bbbeeCertificateExpiryDate,
                    tax: entities.taxClearanceStatus,
                    onboardStatus: entities.onboardingChecklistStatus
                };

            case "generate_final_decision":
                return await DecisionEngine.generateDecisions(entities);

                default:
                    throw new Error(`Unknown action: ${step.action}`);

        }
    }
}

export default ExecutionEngine