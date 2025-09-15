import {registerRoot} from 'remotion';
import {Composition} from 'remotion';
import {AdvancedComposition} from '../src/remotion/AdvancedComposition';
import type {Track} from '../src/types';

const defaultTracks: Track[] = [
  {name: 'Background', items: [{id: 'solid-1', type: 'solid', color: '#111827', from: 0, durationInFrames: 180}]},
  {name: 'Text', items: [
    {id: 'text-1', type: 'text', text: 'Hello from react-app', color: '#ffffff', from: 15, durationInFrames: 120}
  ]},
];

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="Advanced"
        component={AdvancedComposition}
        durationInFrames={300}
        fps={30}
        width={1280}
        height={720}
        defaultProps={{tracks: defaultTracks}}
      />
    </>
  );
};

registerRoot(RemotionRoot);
