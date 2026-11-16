const backend = 'https://github.com/Mikeblackbelt/EVAde-backend-models/blob/main/';
const lit = backend + 'lit%20review/';
const training = backend + 'evade/training/';
const physionet = 'https://physionet.org/content/';
const doi = 'https://doi.org/';

type Citation = {
  key: string;
  title: string;
  url: string;
  authors?: string;
  year?: string;
  venue?: string;
  related?: { label: string; url: string }[];
};

function cite(key: string, title: string, url: string, authors?: string, year?: string, venue?: string): Citation {
  return { key, title, url, authors, year, venue };
}

const datasets: Citation[] = [
  { ...cite('ptb', 'PTB-XL, a large publicly available electrocardiography dataset', doi + '10.1038/s41597-020-0495-6', 'Wagner et al.', '2020', 'Scientific Data 7, 154'),
    related: [{ label: 'PTB-XL 1.0.3 on PhysioNet', url: physionet + 'ptb-xl/1.0.3/' }] },
  cite('chb', 'CHB-MIT Scalp EEG Database and associated thesis (Shoeb, 2009)', physionet + 'chbmit/1.0.0/', 'Shoeb', '2009'),
  cite('siena', 'Siena Scalp EEG Database and associated Processes paper', physionet + 'siena-scalp-eeg/1.0.0/', 'Detti', '2020'),
  { ...cite('sleep', 'Sleep-EDF Database Expanded and associated paper (Kemp et al., 2000)', doi + '10.13026/C2X676', 'Kemp et al.', '2000'),
    related: [{ label: 'Sleep-EDF Expanded on PhysioNet', url: physionet + 'sleep-edfx/1.0.0/' }] },
  cite('mitdb', 'MIT-BIH Arrhythmia Database', physionet + 'mitdb/1.0.0/', undefined, undefined, 'PhysioNet'),
  cite('bidmc', 'BIDMC PPG and Respiration Dataset', physionet + 'bidmc/1.0.0/', undefined, undefined, 'PhysioNet'),
  { ...cite('eegmat', 'EEG During Mental Arithmetic Tasks', doi + '10.3390/data4010014', 'Zyma et al.', '2019', 'Data 4(1), 14'),
    related: [{ label: 'Data on PhysioNet', url: physionet + 'eegmat/1.0.0/' }] },
  cite('nhanes', 'NHANES DXA, 2017 to March 2020', 'https://wwwn.cdc.gov/nchs/nhanes/', 'CDC'),
];

const registryMethods: Citation[] = [
  cite('ecg-benchmark', 'Deep Learning for ECG Analysis: Benchmarks and Insights from PTB-XL', doi + '10.1109/JBHI.2020.3022989', 'Strodthoff et al.', '2021', 'IEEE Journal of Biomedical and Health Informatics 25(5), 1519–1528'),
  cite('sleep-method', 'Deep sleep staging method: TinySleepNet-style epoch CNN and bidirectional GRU', training + 'deep/README_sleep.md', 'EVAde model team', undefined, 'EVAde training documentation'),
  cite('seizure-method', 'Deep seizure-suspect windows: CHB-MIT, with Siena as an external test', training + 'deep/README_seizure.md', 'EVAde model team', '2026', 'EVAde training documentation'),
  cite('beta-method', 'EVAde beta training and held-out evaluation', training + 'README.md', 'EVAde model team', '2026', 'EVAde training documentation'),
  cite('spe-method', 'EVAde solar particle event onset forecasting and evaluation', backend + 'evade/spaceweather/README.md', 'EVAde model team', '2026', 'EVAde space weather documentation'),
];

const reviewedMethods: Citation[] = [
  cite('shoeb-guttag', 'Patient-specific seizure classifiers on CHB-MIT (Shoeb and Guttag study)', lit + 'eeg-applications/README.md', 'Shoeb and Guttag', '2010', 'Proceedings of ICML, 975-982'),
  cite('trees', 'Why do tree-based models still outperform deep learning on typical tabular data?', 'https://arxiv.org/abs/2207.08815', 'Grinsztajn et al.', '2022', 'NeurIPS Datasets and Benchmarks'),
  cite('pan-tompkins', 'Pan–Tompkins QRS detector', lit + 'model-architectures/README.md#ecg', 'Pan and Tompkins', '1985', 'IEEE Transactions on Biomedical Engineering 32(3), 230–236'),
  cite('eegnet', 'EEGNet', doi + '10.1088/1741-2552/aace8c', 'Lawhern et al.', '2018', 'Journal of Neural Engineering 15(5), 056013'),
  cite('szcore', 'SzCORE event-based evaluation', lit + 'planning/fitness-assessment.md', 'Dan et al.', '2025', 'Epilepsia 66 (Suppl. 3), 14–24'),
  cite('ecg-12', 'Deep neural network for 12-lead ECG analysis', doi + '10.1038/s41467-020-15432-4', 'Ribeiro et al.', '2020', 'Nature Communications 11, 1760'),
  cite('ecg-single', 'Deep neural network for single-lead ECG analysis', doi + '10.1038/s41591-018-0268-3', 'Hannun et al.', '2019', 'Nature Medicine 25, 65–69'),
  cite('eeg-conformer', 'EEG Conformer', doi + '10.1109/TNSRE.2022.3230250', 'Song et al.', '2023', 'IEEE Transactions on Neural Systems and Rehabilitation Engineering 31, 710–719'),
  cite('clocs', 'CLOCS: Contrastive Learning of Cardiac Signals Across Space, Time, and Patients', 'https://arxiv.org/abs/2005.13249', 'Kiyasseh, Zhu, and Clifton', '2021', 'ICML / PMLR 139, 5606–5615'),
  cite('ecg-self-supervised', 'Self-supervised learning for clinical 12-lead ECG analysis', doi + '10.1016/j.compbiomed.2021.105114', 'Mehari and Strodthoff', '2022', 'Computers in Biology and Medicine 141, 105114'),
  cite('ecg-fm', 'ECG-FM', doi + '10.1093/jamiaopen/ooaf122', 'McKeen et al.', '2025', 'JAMIA Open 8(5), ooaf122'),
  cite('ecg-founder', 'ECGFounder', doi + '10.1056/AIx2500913', undefined, '2025', 'NEJM AI'),
  cite('labram', 'LaBraM EEG foundation model', 'https://arxiv.org/abs/2405.18765', 'Jiang, Zhao, and Lu', '2024', 'ICLR'),
  cite('attention', 'Attention Is All You Need', 'https://arxiv.org/abs/1706.03762', 'Vaswani et al.', '2017', 'Advances in Neural Information Processing Systems'),
  cite('mamba', 'Mamba: Linear-Time Sequence Modeling with Selective State Spaces', 'https://arxiv.org/abs/2312.00752', 'Gu and Dao', '2024'),
  cite('pos', 'Plane-Orthogonal-to-Skin (POS)', doi + '10.1109/TBME.2016.2609282', 'Wang et al.', '2017', 'IEEE Transactions on Biomedical Engineering 64(7), 1479–1491'),
  cite('mtts-can', 'MTTS-CAN and TS-CAN', 'https://arxiv.org/abs/2006.03790', 'Liu, Fromm, Patel, and McDuff', '2020', 'NeurIPS 33'),
  cite('physnet', 'PhysNet', 'https://arxiv.org/abs/1905.02419', 'Yu, Li, and Zhao', '2019'),
  cite('physformer', 'PhysFormer', doi + '10.1109/CVPR52688.2022.00415', 'Yu et al.', '2022', 'CVPR, 4176–4186'),
  cite('physformer-plus', 'PhysFormer++', doi + '10.1007/s11263-023-01758-1', 'Yu et al.', undefined, 'International Journal of Computer Vision 131(6), 1307–1330'),
  cite('rhythmformer', 'RhythmFormer', doi + '10.1016/j.patcog.2025.111511', 'Zou et al.', '2025', 'Pattern Recognition 164, 111511'),
  cite('scamps', 'SCAMPS synthetic pretraining', doi + '10.52202/068431-0271', 'McDuff et al.', '2022', 'NeurIPS 35, 3744–3757'),
  cite('wearable-fusion', 'Multimodal wearable seizure detection with behind-the-ear EEG', doi + '10.1088/1361-6579/ad4e94', 'Zhang et al.', '2024', 'Physiological Measurement 45(6)'),
  cite('conformal', 'Conformal Prediction: A Gentle Introduction', doi + '10.1561/2200000101', 'Angelopoulos and Bates', '2023', 'Foundations and Trends in Machine Learning 16(4), 494–591'),
];

const medicine: Citation[] = [
  cite('inspiration', 'Inspiration4 (OSD-569 and related studies)', 'https://osdr.nasa.gov/bio/repo/data/studies/OSD-569', 'NASA', undefined, 'Open Science Data Repository'),
  cite('lsda', 'Life Sciences Data Archive and bed-rest campaigns', 'https://www.nasa.gov/hrp/nlsp/', 'NASA', undefined, 'NASA Human Research Program'),
  cite('bone', 'Bone Evidence Report (NTRS 20170004597)', 'https://ntrs.nasa.gov/api/citations/20170004597/downloads/20170004597.pdf', 'NASA', undefined, 'NASA Human Research Program'),
  cite('mir', 'Mir hip and spine bone loss (Lang presentation)', 'https://nasa.gov/wp-content/uploads/2013/10/issrdc_2013-07-16-0945_lang20132.pdf'),
  cite('muscle', 'Muscle and Aerobic Evidence Report (NTRS 20220019338)', 'https://ntrs.nasa.gov/api/citations/20220019338/downloads/Evidence%20report%20aerobic%20and%20muscle_FINAL%209-21-22%20Pubpress%20accepted_v2.pdf', 'NASA', undefined, 'NASA Human Research Program'),
  cite('calf', 'Spaceflight effects on calf muscle (Trappe et al., via Scientific American)', 'https://blogs.scientificamerican.com/news-blog/spaceflight-wreaks-havoc-on-astrona-2009-04-08/', 'Trappe et al.', undefined, 'Journal of Applied Physiology'),
  cite('nasa-sleep', 'Sleep Evidence Report (NTRS 20160003864)', 'https://ntrs.nasa.gov/api/citations/20160003864/downloads/20160003864.pdf', 'NASA', undefined, 'NASA Human Research Program'),
  cite('sleep-meds', 'ISS sleep and use of sleep medication', 'https://www.eurekalert.org/news-releases/595450', undefined, undefined, 'EurekAlert'),
  cite('twins', 'The NASA Twins Study', 'https://lsom.uthscsa.edu/nephrology/wp-content/uploads/sites/38/2019/04/NASA-twin-study_Science.pdf', 'NASA Twins Study team', '2019', 'Science'),
  cite('artemis', 'Radiation measurements aboard Orion during Artemis I', doi + '10.1038/s41586-024-07927-7', 'George et al.', '2024', 'Nature'),
  { ...cite('mars-surface', 'Curiosity RAD radiation measurements on the Martian surface', doi + '10.1126/science.1244797', undefined, '2014', 'Science'),
    related: [{ label: 'Coverage cited in the project', url: 'https://www.sciencedaily.com/releases/2013/12/131209181133.htm' }] },
  { ...cite('mars-transit', 'Curiosity cruise radiation dose', 'https://phys.org/news/2013-12-scientists-publish-surface-mars.amp', undefined, undefined, 'Phys.org'),
    related: [{ label: 'Additional project reference', url: 'https://www.nbcnews.com/sciencemain/radiation-mars-manageable-manned-mission-curiosity-finds-2D11716674' }] },
  { ...cite('protection', 'Radiation Protection Technical Brief (OCHMO-TB-020)', 'https://www.nasa.gov/wp-content/uploads/2023/12/ochmo-tb-020-radiation-protection.pdf', 'NASA OCHMO'),
    related: [{ label: 'Earlier NASA URL cited in the evidence data', url: 'https://www.nasa.gov/sites/default/files/atoms/files/radiation_protection_technical_brief_ochmo.pdf' }] },
  { ...cite('percy', 'Speaking Percy’s Language: How to Talk So Perseverance Will Listen', 'https://science.nasa.gov/blog/speaking-percys-language-how-to-talk-so-perseverance-will-listen/', 'NASA', undefined, 'NASA Science'),
    related: [{ label: 'Perseverance mission link', url: 'https://science.nasa.gov/missions/mars-2020-perseverance/speaking-percys-language-how-to-talk-so-perseverance-will-listen/' }] },
  cite('blackout', 'Communication Delays, Disruptions, and Blackouts for Crewed Mars Missions', 'https://ntrs.nasa.gov/api/citations/20220013418/downloads/ASCEND-Communication%20Delays%2C%20Disruptions%2C%20and%20Blackouts%20for%20Crewed%20Mars%20Missions.pdf', undefined, undefined, 'NASA NTRS / ASCEND'),
  cite('simonsen', 'Simonsen ASCEND radiation estimates (NTRS 20250006168)', 'https://ntrs.nasa.gov/api/citations/20250006168/downloads/ASCEND%20Simonsen%20draft%201.pdf', 'Simonsen', undefined, 'NASA NTRS / ASCEND'),
  cite('swri', 'Radiation exposure associated with a trip to Mars', 'https://www.swri.org/newsroom/press-releases/swri-led-team-calculates-the-radiation-exposure-associated-trip-mars', 'Southwest Research Institute'),
  cite('reference-dose', 'Average Earth radiation dose comparison', 'https://www.csmonitor.com/Science/2013/1209/Curiosity-measures-radiation-at-Martian-surface', undefined, undefined, 'The Christian Science Monitor'),
  cite('surface-total', 'Reference Mars mission radiation total', 'https://www.space.com/23875-mars-radiation-life-manned-mission.html', undefined, undefined, 'Space.com'),
  cite('iss-dose', 'ISS measured radiation and dose-rate variation', 'https://www.swsc-journal.org/articles/swsc/pdf/2016/01/swsc160033.pdf', undefined, undefined, 'Journal of Space Weather and Space Climate'),
  cite('iss-peak', 'Peak dose in ISS radiation measurements', 'https://www.swsc-journal.org/articles/swsc/abs/2017/01/swsc160046/swsc160046.html', undefined, undefined, 'Journal of Space Weather and Space Climate'),
  cite('dosis', 'DOSIS 3D and the September 2017 radiation event', 'https://elib.dlr.de/120788/1/ME-SBA-2018-Berger-Matthi%C3%A4_et%20al-DOSIS-3D_Space%20Weather.pdf', 'Berger, Matthiä et al.', undefined, 'DLR eLib'),
  cite('apollo', 'August 1972 storm and Apollo shielding comparison', 'https://www.space.com/749-bad-week-moon.html', undefined, undefined, 'Space.com'),
  cite('vest', 'AstroRad vest shielding (IAC-24,A1,5,7)', 'https://iafastro.directory/iac/paper/id/90503/abstract-pdf/IAC-24,A1,5,7,x90503.brief.pdf', undefined, '2024', 'International Astronautical Congress'),
  { ...cite('bp', 'In-flight ambulatory blood pressure and fluid shifts', 'https://synapsesocial.com/papers/W1944333689', 'Norsk', '2015'),
    related: [{ label: 'Additional project reference', url: 'https://www.news-medical.net/news/20150114/Weightlessness-in-space-causes-blood-shift-in-astronauts.aspx' }] },
  cite('hrv-case', 'Individual in-flight heart-rate variability', 'https://www.nature.com/articles/s41598-023-36389-6.pdf', undefined, undefined, 'Scientific Reports'),
  cite('hrv-group', 'Group in-flight heart-rate variability and nocturnal heart rate', 'https://www.researchsquare.com/article/rs-2106983/v1', undefined, undefined, 'Research Square preprint'),
  cite('cardiac-output', 'Changes in cardiac output during spaceflight', 'https://pmc.ncbi.nlm.nih.gov/articles/PMC4324697'),
  cite('tilt', 'Postflight orthostatic intolerance', 'https://www.frontiersin.org/article/10.3389/fphys.2020.00784', undefined, undefined, 'Frontiers in Physiology'),
  cite('arrhythmia', 'Cardiac arrhythmias in astronauts', 'https://www.frontiersin.org/articles/10.3389/fphys.2023.1162355/pdf', undefined, undefined, 'Frontiers in Physiology'),
  cite('mars500', 'Sleep and activity during the Mars-500 simulation', 'https://www.med.upenn.edu/uep/assets/user-content/documents/PNAS2013Basner1212646110withSupportingAppendix.pdf', 'Basner et al.', '2013', 'PNAS'),
  cite('cognition', 'Crew cognitive performance during long-duration spaceflight', 'https://frontiersin.org/journals/physiology/articles/10.3389/fphys.2024.1451269/full', undefined, undefined, 'Frontiers in Physiology'),
  cite('virus', 'Latent herpesvirus shedding in astronauts', 'https://pmc.ncbi.nlm.nih.gov/articles/PMC6374706', 'Rooney', '2019'),
  cite('eeg-space', 'Effects of spaceflight on the EEG alpha power and functional connectivity', 'https://www.nature.com/articles/s41598-023-34744-1.pdf', undefined, '2023', 'Scientific Reports'),
  cite('eeg-analog', 'Resting EEG in head-down bed rest', 'https://www.frontiersin.org/articles/10.3389/fphys.2021.638669', undefined, undefined, 'Frontiers in Physiology'),
  cite('antarctic', 'Antarctic evidence on the third-quarter phenomenon', 'https://www.cambridge.org/core/services/aop-cambridge-core/content/view/S003224741700050X', undefined, undefined, 'Polar Record'),
  cite('bone-meta', 'Spaceflight bone loss and recovery meta-analysis', doi + '10.1038/s41526-020-0103-2', 'Stavnichuk et al.', '2020', 'npj Microgravity 6, 13'),
];

const weather: Citation[] = [
  cite('goes-sem', 'GOES Space Environment Monitor (SEM), five-minute averages', 'https://www.ncei.noaa.gov/data/goes-space-environment-monitor/access/avg/', 'NOAA NCEI'),
  cite('goes-r', 'GOES-R SGPS and XRS Level 2 products', 'https://data.ngdc.noaa.gov/platforms/solar-space-observing-satellites/goes/', 'NOAA NCEI'),
  { ...cite('swpc', 'Live GOES integral proton flux and NOAA R/S/G scales', 'https://services.swpc.noaa.gov/json/goes/primary/integral-protons-1-day.json', 'NOAA Space Weather Prediction Center'),
    related: [{ label: 'NOAA scales feed', url: 'https://services.swpc.noaa.gov/products/noaa-scales.json' }, { label: 'Archived solar radiation storm definition', url: 'https://webarchive.library.unt.edu/web/20170121111415/http://www.swpc.noaa.gov/phenomena/solar-radiation-storm' }] },
  cite('donki', 'Space Weather Database Of Notifications, Knowledge, Information (DONKI)', 'https://api.nasa.gov/#DONKI', 'NASA'),
  cite('cdaw', 'SOHO/LASCO CDAW CME Catalog (associated paper: Yashiro et al., 2004)', 'https://cdaw.gsfc.nasa.gov/CME_list/', 'NASA / Catholic University of America'),
  cite('storm', 'What is a solar radiation storm?', 'https://www.spaceweatherlive.com/en/help/what-is-a-solar-radiation-storm.html', 'SpaceWeatherLive'),
];

export const bibliography = [
  { title: 'Datasets', entries: datasets },
  {
    title: 'Models and methods (including reviewed candidates)',
    entries: [...registryMethods, ...reviewedMethods],
    reviewedStart: registryMethods.length,
  },
  { title: 'Space medicine and radiation', entries: medicine },
  { title: 'Space weather', entries: weather },
].map((group, index, groups) => {
  const previous = groups.slice(0, index).reduce((total, item) => total + item.entries.length, 0);
  return { ...group, entries: group.entries.map((entry, i) => ({ ...entry, number: previous + i + 1 })) };
});

export const citations = new Map(bibliography.flatMap(group => group.entries.map(entry => [entry.key, entry])));
