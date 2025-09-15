type BaseItem = {
  from: number;
  durationInFrames: number;
  id: string;
};

export type SolidItem = BaseItem & {
  type: "solid";
  color: string;
};

export type TextItem = BaseItem & {
  type: "text";
  text: string;
  color: string;
};

export type VideoItem = BaseItem & {
  type: "video";
  src: string;
  frameRate?: number; // Store the actual video frame rate
};

export type ImageItem = BaseItem & {
  type: "image";
  src: string;
};

export type AudioItem = BaseItem & {
  type: "audio";
  src: string;
};

export type Item = SolidItem | TextItem | VideoItem | ImageItem | AudioItem;

export type Track = {
  name: string;
  items: Item[];
};
