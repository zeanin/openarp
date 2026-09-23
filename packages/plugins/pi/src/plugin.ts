import { Plugin } from '@formai/plugin';
import { PiAgentService } from './pi-service';

export class PiPlugin extends Plugin {
  private piService?: PiAgentService;

  async load(): Promise<void> {
    const config = this.app.config?.ai || {};

    // 1. Initialize Pi Agent Engine Service
    this.piService = new PiAgentService(this.app);

    // 2. Expose on application instance
    this.app.pi = this.piService;

    // 3. Provide backwards compatibility proxy for any legacy codex references
    this.app.codex = {
      isPiProxy: true,
      piService: this.piService,
      startThread: (options: any = {}) => {
        // Return a thread adapter that routes to Pi session
        let activeSession: any = null;
        let sessionId: string | null = null;
        const appInstance = this.app;

        return {
          get id() {
            return sessionId;
          },
          run: async (input: string | any[], turnOptions: any = {}) => {
            const promptStr = typeof input === 'string' ? input : JSON.stringify(input);
            if (!activeSession) {
              const res = await appInstance.pi.createSession({
                workingDirectory: options.workingDirectory,
                providerConfig: options.llmProvider || options,
                skillContext: options.skillContext,
                enablePlatformSkills: false,
              });
              activeSession = res.session;
              sessionId = res.sessionId;
            }
            const output = await appInstance.pi.runPrompt(activeSession, promptStr, {
              outputSchema: turnOptions.outputSchema,
              signal: turnOptions.signal,
            });
            return {
              finalResponse: output,
              items: [],
              usage: null,
            };
          },
        };
      },
      resumeThread: (id: string, options: any = {}) => {
        return (this.app.codex as any).startThread(options);
      },
    };

    console.log('[Pi Plugin] Pi Agent Engine successfully initialized on app.pi (with app.codex compatibility proxy).');
  }

  async destroy(): Promise<void> {
    if (this.app.pi) {
      delete this.app.pi;
    }
    if (this.app.codex?.isPiProxy) {
      delete this.app.codex;
    }
    console.log('[Pi Plugin] Pi Agent Engine cleanly destroyed.');
  }
}

export default PiPlugin;
