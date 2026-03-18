import { useState } from 'react';
import { Welcome }    from './steps/Welcome';
import { Location }   from './steps/Location';
import { Models }     from './steps/Models';
import { Installing } from './steps/Installing';
import { Done }       from './steps/Done';

type Step = 'welcome' | 'location' | 'models' | 'installing' | 'done';

export interface WizardState {
  dataDir: string;
  models: { phi3: boolean; moondream: boolean };
}

const STEPS: Step[] = ['welcome', 'location', 'models', 'installing', 'done'];

export default function App() {
  const [step, setStep] = useState<Step>('welcome');
  const [state, setState] = useState<WizardState>({
    dataDir: '',
    models: { phi3: true, moondream: true },
  });

  const progress = (STEPS.indexOf(step) / (STEPS.length - 1)) * 100;

  return (
    <div style={{
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
      background: '#0f1117',
      color: '#e2e8f0',
      height: '100vh',
      display: 'flex',
      flexDirection: 'column',
      userSelect: 'none',
    }}>
      {/* Progress bar */}
      <div style={{ height: 3, background: '#1a1d24', flexShrink: 0 }}>
        <div style={{
          height: '100%',
          width: `${progress}%`,
          background: 'linear-gradient(90deg, #6366f1, #818cf8)',
          transition: 'width 0.4s ease',
        }} />
      </div>

      {/* Step content */}
      <div style={{ flex: 1, overflow: 'auto' }}>
        {step === 'welcome'    && <Welcome    onNext={() => setStep('location')} />}
        {step === 'location'   && (
          <Location
            state={state}
            setState={setState}
            onNext={() => setStep('models')}
            onBack={() => setStep('welcome')}
          />
        )}
        {step === 'models'     && (
          <Models
            state={state}
            setState={setState}
            onNext={() => setStep('installing')}
            onBack={() => setStep('location')}
          />
        )}
        {step === 'installing' && (
          <Installing state={state} onDone={() => setStep('done')} />
        )}
        {step === 'done'       && <Done />}
      </div>
    </div>
  );
}
