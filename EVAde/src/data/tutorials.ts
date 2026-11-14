export type TutorialCategory = 'Vitals' | 'Blood' | 'Musculoskeletal' | 'Radiation' | 'Mind & sleep';

export interface Tutorial {
  id: string;
  title: string;
  summary: string;
  category: TutorialCategory;
  minutes: number;
  xp: number;
  videoSrc: string;
  posterSrc: string;
  steps: string[];
}

export const TUTORIAL_CATEGORIES: TutorialCategory[] = ['Vitals', 'Blood', 'Musculoskeletal', 'Radiation', 'Mind & sleep'];

export const CATEGORY_COLORS: Record<TutorialCategory, 'blue' | 'pink' | 'orange' | 'yellow' | 'purple'> = {
  Vitals: 'blue',
  Blood: 'pink',
  Musculoskeletal: 'orange',
  Radiation: 'yellow',
  'Mind & sleep': 'purple',
};

// Replace videoSrc/posterSrc with Cloudflare Stream or R2 URLs when uploaded.
export const TUTORIALS: Tutorial[] = [
  {
    id: 'bp-cuff', title: 'Blood pressure with the cuff', category: 'Vitals', minutes: 4, xp: 30,
    summary: 'Seat yourself with restraints, wrap the cuff and log a clean reading.',
    videoSrc: '', posterSrc: '',
    steps: ['Anchor feet in the foot restraints and rest 5 minutes', 'Wrap the cuff two fingers above the elbow', 'Keep your arm at heart level and stay still', 'Press start and breathe normally', 'Confirm the reading syncs to EVAde'],
  },
  {
    id: 'ecg-patch', title: 'Placing the ECG chest patch', category: 'Vitals', minutes: 6, xp: 40,
    summary: 'Prep skin and place leads so the ECG model gets a clean signal.',
    videoSrc: '', posterSrc: '',
    steps: ['Clean skin with an alcohol wipe and let it dry', 'Peel the patch backing without touching the gel', 'Place the patch below the left collarbone', 'Press firmly for 30 seconds', 'Check the live waveform on the dashboard'],
  },
  {
    id: 'temp-sensor', title: 'Core temperature sensor check', category: 'Vitals', minutes: 3, xp: 20,
    summary: 'Verify the forehead sensor contact and calibration each morning.',
    videoSrc: '', posterSrc: '',
    steps: ['Wipe the sensor face', 'Seat it on the center of the forehead', 'Wait for the green calibration light', 'Compare against the reference thermometer'],
  },
  {
    id: 'glucose-cgm', title: 'Fingerstick & CGM calibration', category: 'Blood', minutes: 5, xp: 35,
    summary: 'Collect a droplet in microgravity without it floating away.',
    videoSrc: '', posterSrc: '',
    steps: ['Wash and dry hands, warm the fingertip', 'Lance the side of the fingertip', 'Touch the strip to the droplet — do not squeeze', 'Enter the value to calibrate the CGM', 'Dispose of the lancet in the sharps bag'],
  },
  {
    id: 'blood-draw', title: 'Venous blood draw for immune panel', category: 'Blood', minutes: 12, xp: 80,
    summary: 'Draw, spin and freeze samples for the immune marker panel.',
    videoSrc: '', posterSrc: '',
    steps: ['Set up the kit on the velcro tray', 'Apply the tourniquet and locate the vein', 'Draw two tubes in order', 'Centrifuge for 10 minutes', 'Stow samples in MELFI at −80 °C'],
  },
  {
    id: 'ultrasound-bone', title: 'Bone ultrasound self-scan', category: 'Musculoskeletal', minutes: 10, xp: 60,
    summary: 'Guided heel and hip scans to track bone density loss.',
    videoSrc: '', posterSrc: '',
    steps: ['Apply gel to the probe', 'Follow the on-screen heel target', 'Hold steady for three captures', 'Repeat at the hip marker', 'Review the density estimate'],
  },
  {
    id: 'ared-form', title: 'ARED resistive exercise form', category: 'Musculoskeletal', minutes: 8, xp: 50,
    summary: 'Squats and deadlifts on ARED to slow bone and muscle loss.',
    videoSrc: '', posterSrc: '',
    steps: ['Set load per the daily prescription', 'Clip into the harness', 'Keep a neutral spine through each rep', 'Log sets and reps'],
  },
  {
    id: 'dosimeter', title: 'Reading your personal dosimeter', category: 'Radiation', minutes: 2, xp: 15,
    summary: 'Download the daily dose and check for solar event alerts.',
    videoSrc: '', posterSrc: '',
    steps: ['Dock the dosimeter on the reader', 'Wait for the sync tone', 'Review the daily dose', 'Clip it back to your chest pocket'],
  },
  {
    id: 'sleep-setup', title: 'Sleep station setup', category: 'Mind & sleep', minutes: 5, xp: 25,
    summary: 'Lighting, noise and headband EEG for better rest.',
    videoSrc: '', posterSrc: '',
    steps: ['Switch station lighting to the pre-sleep amber profile', 'Fit the EEG headband snugly', 'Insert earplugs and secure the sleeping bag', 'Start the sleep session in EVAde'],
  },
  {
    id: 'mood-checkin', title: 'Behavioral health check-in', category: 'Mind & sleep', minutes: 4, xp: 25,
    summary: 'A quick self-assessment and breathing reset.',
    videoSrc: '', posterSrc: '',
    steps: ['Find a quiet module', 'Answer the five-question survey honestly', 'Follow the 4-7-8 breathing guide', 'Write one line in your journal'],
  },
];
