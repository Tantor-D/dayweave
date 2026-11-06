import { WorkbenchView as Neumorphism } from './presentations/neumorphism/Workbench';
import neumorphismControls from './presentations/neumorphism/Workbench.module.css';
import neumorphismStatistics from './presentations/neumorphism/Statistics.module.css';
import { useWorkbench } from './application/useWorkbench';
import { AppearanceContext } from './presentations/Appearance';
import { WorkbenchView as Glass } from './presentations/glass/Workbench';
import { WorkbenchView as Neobrutalism } from './presentations/neobrutalism/Workbench';
import glassControls from './presentations/glass/Workbench.module.css';
import glassStatistics from './presentations/glass/Statistics.module.css';
import neoControls from './presentations/neobrutalism/Workbench.module.css';
import neoStatistics from './presentations/neobrutalism/Statistics.module.css';
import { WorkbenchView as Claymorphism } from './presentations/claymorphism/Workbench';
import clayControls from './presentations/claymorphism/Workbench.module.css';
import clayStatistics from './presentations/claymorphism/Statistics.module.css';
import type { ThemeDefinition } from './themes';
import './base.css';
const presentations = {
  neumorphism: {
    View: Neumorphism,
    appearance: { controls: neumorphismControls, statistics: neumorphismStatistics },
  },
  claymorphism: {
    View: Claymorphism,
    appearance: { controls: clayControls, statistics: clayStatistics },
  },
  glass: { View: Glass, appearance: { controls: glassControls, statistics: glassStatistics } },
  neobrutalism: {
    View: Neobrutalism,
    appearance: { controls: neoControls, statistics: neoStatistics },
  },
};
const familyByTheme: Record<ThemeDefinition['id'], keyof typeof presentations> = {
  'glass-light': 'glass',
  'liquid-glass-light': 'glass',
  'glass-dark': 'glass',
  'neobrutalism-light': 'neobrutalism',
  'claymorphism-light': 'claymorphism',
  'neumorphism-light': 'neumorphism',
};
export default function App() {
  const workbench = useWorkbench();
  const presentation = presentations[familyByTheme[workbench.preferences.theme]];
  const View = presentation.View;
  return (
    <AppearanceContext.Provider value={presentation.appearance}>
      <View workbench={workbench} />
    </AppearanceContext.Provider>
  );
}
