import { Badge } from '@astryxdesign/core/Badge';
import { Icon } from '@astryxdesign/core/Icon';
import { CheckCircleIcon, ExclamationTriangleIcon, XCircleIcon } from '@heroicons/react/20/solid';
import { STATUS_STYLES, type HealthStatus } from '../data/status';

const STATUS_ICONS = { nominal: CheckCircleIcon, caution: ExclamationTriangleIcon, critical: XCircleIcon };

// Status pill pairing color with an icon and label (never color alone).
export default function StatusBadge({ status, label }: { status: HealthStatus; label?: string }) {
  const style = STATUS_STYLES[status];
  return <Badge variant={style.badge} label={label ?? style.label} icon={<Icon icon={STATUS_ICONS[status]} size="xsm" />} />;
}
