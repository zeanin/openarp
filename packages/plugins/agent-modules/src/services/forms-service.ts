export interface FormStepConfig {
  id: string;
  title: string;
  description?: string;
  fields: Array<{
    name: string;
    label: string;
    type: 'string' | 'number' | 'text' | 'select' | 'boolean' | 'date';
    required?: boolean;
    options?: Array<{ label: string; value: any }>;
    placeholder?: string;
  }>;
}

export interface MultiStepFormDefinition {
  id: string;
  title: string;
  description?: string;
  targetCollection: string;
  isPublic: boolean;
  steps: FormStepConfig[];
}

export interface FormSubmissionSession {
  id: string;
  formId: string;
  currentStepIndex: number;
  data: Record<string, any>;
  status: 'draft' | 'completed';
  createdAt: string;
  updatedAt: string;
}

export class FormsService {
  private formDefs: Map<string, MultiStepFormDefinition> = new Map();
  private submissions: Map<string, FormSubmissionSession> = new Map();

  registerForm(def: MultiStepFormDefinition): void {
    this.formDefs.set(def.id, def);
  }

  getForm(id: string): MultiStepFormDefinition | null {
    return this.formDefs.get(id) || null;
  }

  startSubmission(formId: string): FormSubmissionSession {
    const form = this.formDefs.get(formId);
    if (!form) throw new Error(`Form definition ${formId} not found`);

    const id = `sub_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const now = new Date().toISOString();
    const session: FormSubmissionSession = {
      id,
      formId,
      currentStepIndex: 0,
      data: {},
      status: 'draft',
      createdAt: now,
      updatedAt: now,
    };
    this.submissions.set(id, session);
    return session;
  }

  saveStep(submissionId: string, stepIndex: number, stepData: Record<string, any>): FormSubmissionSession {
    const session = this.submissions.get(submissionId);
    if (!session) throw new Error(`Submission session ${submissionId} not found`);

    session.data = { ...session.data, ...stepData };
    session.currentStepIndex = stepIndex + 1;
    session.updatedAt = new Date().toISOString();
    this.submissions.set(submissionId, session);
    return session;
  }

  async finalizeSubmission(
    submissionId: string,
    recordCreator: (collection: string, data: Record<string, any>) => Promise<any>
  ): Promise<{ submissionId: string; recordId: any }> {
    const session = this.submissions.get(submissionId);
    if (!session) throw new Error(`Submission session ${submissionId} not found`);

    const form = this.formDefs.get(session.formId);
    if (!form) throw new Error(`Form definition ${session.formId} not found`);

    session.status = 'completed';
    session.updatedAt = new Date().toISOString();

    const createdRecord = await recordCreator(form.targetCollection, session.data);
    return {
      submissionId,
      recordId: createdRecord.id || createdRecord._id || `rec_${Date.now()}`,
    };
  }
}
