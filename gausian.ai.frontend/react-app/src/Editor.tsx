import { useMemo, useState } from "react";
import { Player } from "@remotion/player";
import type { Track } from "./types";
import { Main } from "./remotion/MainComposition";

export const Editor = () => {
  const [tracks] = useState<Track[]>([
    { name: "Track 1", items: [] },
    { name: "Track 2", items: [] },
    { name: "Track 3", items: [] },
  ]);

  const inputProps = useMemo(() => {
    return {
      tracks,
    };
  }, [tracks]);

  return (
    <>
      <Player
        component={Main}
        fps={30}
        inputProps={inputProps}
        durationInFrames={600}
        compositionWidth={1280}
        compositionHeight={720}
      />
    </>
  );
};
