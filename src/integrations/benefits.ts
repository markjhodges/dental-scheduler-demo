export type BenefitResult = {
  status: 'not_checked'|'supported'|'unavailable';
  source: string | null;
  checkedAt: string | null;
  validUntil: string | null;
  estimate: {currency:string;patientMinor:number;disclaimer:string} | null;
};

export interface BenefitsEstimator {
  estimateRoutine(practiceId:string,patientId:string,appointmentTypeId:string):Promise<BenefitResult>;
  estimateTreatment(practiceId:string,patientId:string,planId:string):Promise<BenefitResult>;
}

export class UnavailableBenefitsEstimator implements BenefitsEstimator {
  async estimateRoutine():Promise<BenefitResult> { return this.unavailable(); }
  async estimateTreatment():Promise<BenefitResult> { return this.unavailable(); }
  private unavailable():BenefitResult {
    return {status:'unavailable',source:null,checkedAt:null,validUntil:null,estimate:null};
  }
}

export function benefitsEstimator():BenefitsEstimator { return new UnavailableBenefitsEstimator(); }
