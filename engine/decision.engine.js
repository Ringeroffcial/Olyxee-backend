class DecisionEngine {
    static generateDecisions(entities) {
        const reasons = [];
        const blockers = [];
        const actions = [];

        //handling missing documents
        if(entities?.onboardingChecklistStatus != "complete") {
            blockers.push("Mandatory onboarding documents missing");
            actions.push("Submit reqired missing documents");
        }

        //handling legal issues
        if(entities.contractReviewStatus === "flagged") {
            blockers.push(`Contract issue: ${entities.contractFlagReason}`);
            actions.push("Resolve the contract issue");
        }

        //handling the expiry 
        const expiry = new Date(entities.bbbeeCertificateExpiryDate);
        const today = new Date();
        const diffDay = (expiry - today) / (1000 * 60 * 60 * 24);

        if(diffDay <= 90){
            reasons.push("BBBEE expiring soon");
            actions.push("Renew BBBEE certifiaction");
        }

        //handling the decisions logic
        let status = "completed";
        let decision = "approved";

        if(blockers.length > 0) {
           status = entities.serviceCoverageImpact === "high" ? "completed" : "blocked";
           decision = entities.serviceCoverageImpact === "high" ? "conditionally_approved" : "blocked";
        }

        return{
            status,
            decision,
            reasons,
            blockers,
            actions,
            evaluatedAt: new Date().toISOString()
        };

    }

}
