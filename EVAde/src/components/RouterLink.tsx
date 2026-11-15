import type { ComponentPropsWithRef } from 'react';
import { Link } from 'react-router-dom';

type RouterLinkProps = ComponentPropsWithRef<'a'>;

// External, hash and mail links bypass the client router.
function isExternal(href: string) {
  return /^(https?:|mailto:|tel:|#)/.test(href);
}

// Adapter that lets Astryx links navigate with React Router + View Transitions.
export default function RouterLink({ href = '', ...rest }: RouterLinkProps) {
  if (isExternal(href)) return <a href={href} {...rest} />;
  return <Link to={href} viewTransition {...rest} />;
}
