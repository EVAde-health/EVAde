// The evade theme. `astryx experimental theme editor` wrote this file once and never changes it again.
// The checked settings live in evade.settings.json and the generated evade.settings.ts;
// change them with `astryx experimental theme editor set evade ...`. Add your own changes below: they win over the settings.
import {defineTheme} from '@astryxdesign/core/theme';
import {evadeSettings} from './evade.settings';

export const evadeTheme = defineTheme({
  extends: evadeSettings,
  name: 'evade',
});
