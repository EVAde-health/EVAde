const app = 'https://github.com/deconghh/EVAde/blob/main/';
const models = 'https://github.com/Mikeblackbelt/EVAde-backend-models/blob/main/';
const planning = models + 'lit%20review/planning/';
const architectures = models + 'lit%20review/model-architectures/README.md';
const training = planning + 'training-plan-v2.md';
const fitness = planning + 'fitness-assessment.md';
const registry = models + 'MODEL_REGISTRY.md';
const spaceWeather = models + 'evade/spaceweather/README.md';
const cloud = app + 'cloud/README.md';

export type ReleaseStatus = 'Shipped' | 'In progress' | 'Planned' | 'Research';
export const roadmapGroups = ['Models', 'Monitoring', 'Platform', 'Safety & evaluation'] as const;
type RoadmapGroup = typeof roadmapGroups[number];
type Source = { label: string; href: string };
type RoadmapItem = { text: string; source: Source | 'team proposal' };
type Release = {
  version: string;
  title: string;
  window: string;
  status: ReleaseStatus;
  groups: Partial<Record<RoadmapGroup, RoadmapItem[]>>;
};

export const roadmap: Release[] = [
  {
    version: 'v0.1',
    title: 'Hackathon demo',
    window: 'Nov 15, 2026',
    status: 'Shipped',
    groups: {
      Models: [
        { text: 'EVA-2, EVA-6, EVA-12, EVA-13 and EVA-14 serve through the Cloudflare model gateway.',
          source: { label: 'Model registry', href: registry + '#registry' } },
      ],
      Monitoring: [
        { text: 'The simulated crew gets hourly model runs.', source: { label: 'Simulation scheduler', href: app + 'cloud/worker/src/index.ts#L1275' } },
        { text: 'The Research page presents NASA evidence on crew health and radiation.', source: { label: 'Research page', href: app + 'EVAde/src/pages/ResearchPage.tsx' } },
        { text: 'Space weather updates use live NOAA SWPC feeds.', source: { label: 'NOAA feed integration', href: app + 'cloud/worker/src/index.ts#L270' } },
      ],
      Platform: [
        { text: 'The staff console lets staff review crew health and emergencies.', source: { label: 'Staff console routes', href: app + 'EVAde/src/App.tsx' } },
        { text: 'The Journal supports voice check-ins with Grok.', source: { label: 'Voice Worker', href: app + 'AGENTS.md#live-urls' } },
        { text: 'The Journal text companion runs on Grok.', source: { label: 'Journal companion', href: app + 'cloud/worker/src/companion.ts' } },
      ],
      'Safety & evaluation': [
        { text: 'Cloudflare Access sign-in uses roles stored in D1.', source: { label: 'Access setup', href: cloud + '#login-with-cloudflare-access' } },
      ],
    },
  },
  {
    version: 'v0.2',
    title: 'Wearable inputs and model checks',
    window: 'Next',
    status: 'Planned',
    groups: {
      Models: [
        { text: 'Retrain deep seizure on more CHB-MIT subjects and test it against EVA-2 on held-out subjects and Siena.',
          source: { label: 'Seizure training plan', href: training + '#53-eeg-seizure-suspect-windows-chb-mit-with-siena-external-test-sessions-s3a-and-s3' } },
      ],
      Monitoring: [
        { text: 'Extend the Pi BLE gateway to real devices: an RR-capable heart-rate strap, a 1-lead ECG patch, PPG and a 4-channel EEG headband.',
          source: { label: 'Pi Bluetooth test plan', href: planning + 'pi-bluetooth-stream-test.md#3-simulated-devices-and-the-bandwidth-check' } },
      ],
      Platform: [
        { text: 'Add a Signals card to replay stored synthetic waveforms.', source: 'team proposal' },
        { text: 'Restore the dedicated staff Access app.', source: 'team proposal' },
      ],
      'Safety & evaluation': [
        { text: 'Calibrate EVA-13 review thresholds on the held-out validation fold.', source: { label: 'ECG training plan', href: training + '#51-ecg-ptb-xl-diagnostic-superclass-session-s1' } },
        { text: 'Report event sensitivity, false alarms per day and event F1 using SzCORE-style seizure scoring.',
          source: { label: 'Fitness assessment', href: fitness + '#eeg' } },
        { text: 'Require subject-wise validation and external testing where feasible before moving models from draft to active.',
          source: { label: 'Fitness gates', href: fitness + '#2-fitness-gates-per-module' } },
      ],
    },
  },
  {
    version: 'v0.3',
    title: 'Broader crew monitoring',
    window: 'Later',
    status: 'Research',
    groups: {
      Models: [
        { text: 'Evaluate xresnet1d101 for serving once it has a registry ID.', source: { label: 'Model registry', href: registry + '#registry' } },
        { text: 'Reassess the EVA-10 CME architecture using NASA DONKI context before switching from the GOES-only forecast.',
          source: { label: 'CME forecast results', href: spaceWeather + '#results-2026-11-15-draft' } },
        { text: 'Compare decision-level and feature-level fusion for risk estimates across ECG, EEG and other inputs.',
          source: { label: 'Multimodal fusion review', href: architectures + '#7-multimodal-fusion-ecg-with-eeg-and-others' } },
        { text: 'Evaluate ECG-FM, ECGFounder and LaBraM as research candidates.', source: { label: 'Architecture review', href: architectures } },
      ],
      Monitoring: [
        { text: 'Compare camera-based heart-rate estimates using POS as the baseline and PhysNet or PhysFormer as candidates.',
          source: { label: 'Camera monitoring review', href: architectures + '#5-ppg-and-remote-ppg-rppg' } },
        { text: 'Evaluate behind-the-ear EEG separately for seizure-suspect flags.', source: { label: 'Wearable EEG review', href: architectures + '#4-eeg' } },
        { text: 'Use NHANES DXA as the reference for longitudinal bone tracking.', source: { label: 'Data acquisition plan', href: planning + 'data-acquisition-plan.md#bone' } },
        { text: 'Track muscle changes across missions using NASA muscle and aerobic evidence.', source: { label: 'NASA evidence sources', href: app + 'sources.md#nasa-human-research-program-evidence-reports' } },
        { text: 'Study per-person changes in behavior and cognition using sleep, HRV, cognition and optional EEG measures.',
          source: { label: 'Behavioral trend review', href: architectures + '#6-behavioral-trend-model' } },
      ],
      Platform: [
        { text: 'Extend offline sync for interrupted links.', source: { label: 'Offline sync', href: cloud + '#challenge-objectives-covered-by-this-layer' } },
        { text: 'Extend the check-in demo for Mars communications delay.', source: { label: 'Mars mission references', href: app + 'sources.md#nasa-radiation-and-mission-references' } },
      ],
      'Safety & evaluation': [
        { text: 'Study conformal prediction intervals for uncertainty in longitudinal monitoring.',
          source: { label: 'Uncertainty review', href: architectures + '#9-calibration-and-uncertainty-applies-to-every-module' } },
      ],
    },
  },
];
