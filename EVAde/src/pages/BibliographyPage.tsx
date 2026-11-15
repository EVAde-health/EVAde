import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { Link } from '@astryxdesign/core/Link';
import { VStack } from '@astryxdesign/core/Stack';
import { Heading, Text } from '@astryxdesign/core/Text';
import PageHeader from '../components/PageHeader';
import { bibliography } from '../data/bibliography';

type Citation = (typeof bibliography)[number]['entries'][number];

function CitationList({ entries }: { entries: Citation[] }) {
  return (
    <ol start={entries[0].number}>
      {entries.map(entry => (
        <li id={`ref-${entry.number}`} key={entry.key} tabIndex={-1}>
          <VStack gap={0.5} paddingBlock={1}>
            <Text>
              {entry.authors && `${entry.authors}${entry.year ? ` (${entry.year})` : ''}. `}
              {!entry.authors && entry.year && `${entry.year}. `}
              <Link href={entry.url} isExternalLink>{entry.title}</Link>
              {entry.venue && `. ${entry.venue}`}
            </Text>
            {(!entry.authors || !entry.venue || !entry.year) && <Text type="supporting">citation details to confirm</Text>}
            {entry.related?.map(source => <Link key={source.url} href={source.url} isExternalLink>{source.label}</Link>)}
          </VStack>
        </li>
      ))}
    </ol>
  );
}

export default function BibliographyPage() {
  const { hash } = useLocation();
  useEffect(() => {
    const entry = /^#ref-\d+$/.test(hash) && document.getElementById(hash.slice(1));
    if (entry) {
      entry.scrollIntoView();
      entry.focus({ preventScroll: true });
    } else {
      window.scrollTo(0, 0);
    }
  }, [hash]);

  return (
    <VStack as="main" gap={5} padding={6} className="page">
      <PageHeader title="Bibliography" description="Data, training methods, and evidence referenced by the EVAde project."
        actions={<><Link href="/">Home</Link><Link href="/models">Models</Link></>} />
      {bibliography.map(group => (
        <VStack as="section" key={group.title} gap={2}>
          <Heading level={2}>{group.title}</Heading>
          {group.reviewedStart === undefined ? <CitationList entries={group.entries} /> : (
            <>
              <Text type="supporting">
                EVAde trains and serves EVA-02, 06, 12, 13 and 14. The other entries were reviewed in Michael's literature review as candidates and are not used in the demo.
              </Text>
              <Heading level={3}>Sources for registry models</Heading>
              <Text type="supporting">Michael ran EVAde's model training and evaluation.</Text>
              <CitationList entries={group.entries.slice(0, group.reviewedStart)} />
              <Heading level={3}>Reviewed candidates</Heading>
              <CitationList entries={group.entries.slice(group.reviewedStart)} />
            </>
          )}
        </VStack>
      ))}
    </VStack>
  );
}
