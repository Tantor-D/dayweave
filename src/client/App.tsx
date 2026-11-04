import { useWorkbench } from './application/useWorkbench';
import { AppearanceContext } from './presentations/Appearance';
import { WorkbenchView as Glass } from './presentations/glass/Workbench';
import { WorkbenchView as Neobrutalism } from './presentations/neobrutalism/Workbench';
import glassControls from './presentations/glass/Workbench.module.css';
import glassStatistics from './presentations/glass/Statistics.module.css';
import neoControls from './presentations/neobrutalism/Workbench.module.css';
import neoStatistics from './presentations/neobrutalism/Statistics.module.css';
import './base.css';
const presentations = {
  glass: { View: Glass, appearance: { controls: glassControls, statistics: glassStatistics } },
  neobrutalism: {
    View: Neobrutalism,
    appearance: { controls: neoControls, statistics: neoStatistics },
  },
};
export default function App() {
  const workbench = useWorkbench();
  const presentation =
    presentations[workbench.preferences.theme === 'neobrutalism-light' ? 'neobrutalism' : 'glass'];
  const View = presentation.View;
  return (
    <AppearanceContext.Provider value={presentation.appearance}>
      <View workbench={workbench} />
    </AppearanceContext.Provider>
  );
}
