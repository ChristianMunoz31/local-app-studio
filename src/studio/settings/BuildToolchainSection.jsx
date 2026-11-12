import { Wrench } from 'lucide-react';
import StudioSectionCard from '../components/StudioSectionCard';
import { sectionProps } from '../../components/settings/settingsSections';
import ToolchainChecklist from '../components/ToolchainChecklist';
import { useToolchain } from '../hooks/useToolchain';

/** Which build tools this PC has, with the path of each and what to install when one is missing. */
export default function BuildToolchainSection() {
  const { report, loading, error, refresh } = useToolchain();

  return (
    <StudioSectionCard
      {...sectionProps('build-toolchain')}
      title="Build tools"
      icon={Wrench}
      subtitle="The tools Local App Studio uses to build an installer for your app."
    >
      <ToolchainChecklist report={report} loading={loading} error={error} onRefresh={() => void refresh()} heading={null} />
    </StudioSectionCard>
  );
}
