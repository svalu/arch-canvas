// 앱 아이콘은 전부 Hugeicons(무료 stroke 세트) 하나로 쓴다. 이름만 넘기면 된다: <Icon name="save" />
// 새 아이콘이 필요하면 아래 표에 한 줄 추가. 이모지·글자 기호(✦ 📄 ×)는 쓰지 않는다.
import React from 'react';
import { HugeiconsIcon } from '@hugeicons/react';
import {
  FileAddIcon, FolderOpenIcon, FloppyDiskIcon, LayoutTemplateIcon, ArrowDown01Icon, ServerStack01Icon, NoteIcon,
  Undo02Icon, Redo02Icon, Copy01Icon, SparklesIcon, SidebarRightIcon, SecurityCheckIcon, SignpostIcon, HelpCircleIcon,
  SlidersHorizontalIcon, Loading03Icon, TextIcon, Layers01Icon, BubbleChatIcon, File01Icon, GridViewIcon,
  LeftToRightListBulletIcon, PencilEdit02Icon, SquareLock01Icon, SquareUnlock01Icon, Download04Icon, Refresh01Icon,
  ArrowRight01Icon, ArrowRight02Icon, ArrowLeft01Icon, Cancel01Icon, Tick02Icon, ArrowUpRight01Icon, DragDropVerticalIcon,
  MoreVerticalIcon, SquareArrowUpRight02Icon, SquareArrowLeft02Icon, BulbIcon, Attachment01Icon, AlertDiamondIcon,
  InformationCircleIcon, Upload04Icon, AlignStartVerticalIcon, AlignEndVerticalIcon, AlignHorizontalCenterIcon,
  AlignStartHorizontalIcon, AlignEndHorizontalIcon, AlignVerticalCenterIcon, DistributeHorizontalCenterIcon, DistributeVerticalCenterIcon,
} from '@hugeicons/core-free-icons';

const I = {
  new: FileAddIcon, open: FolderOpenIcon, save: FloppyDiskIcon, template: LayoutTemplateIcon, caret: ArrowDown01Icon,
  infra: ServerStack01Icon, card: NoteIcon, undo: Undo02Icon, redo: Redo02Icon, copy: Copy01Icon, sparkle: SparklesIcon,
  panel: SidebarRightIcon, shield: SecurityCheckIcon, guide: SignpostIcon, help: HelpCircleIcon, settings: SlidersHorizontalIcon,
  spinner: Loading03Icon, text: TextIcon, layers: Layers01Icon, feedback: BubbleChatIcon,
  file: File01Icon, grid: GridViewIcon, list: LeftToRightListBulletIcon, draw: PencilEdit02Icon,
  lock: SquareLock01Icon, unlock: SquareUnlock01Icon, download: Download04Icon, refresh: Refresh01Icon, upload: Upload04Icon,
  chevron: ArrowRight01Icon, arrow: ArrowRight02Icon, back: ArrowLeft01Icon, close: Cancel01Icon, check: Tick02Icon,
  external: ArrowUpRight01Icon, grip: DragDropVerticalIcon, more: MoreVerticalIcon, detach: SquareArrowUpRight02Icon,
  dock: SquareArrowLeft02Icon, tip: BulbIcon, attach: Attachment01Icon, alert: AlertDiamondIcon, info: InformationCircleIcon,
  'al-left': AlignStartVerticalIcon, 'al-hcenter': AlignHorizontalCenterIcon, 'al-right': AlignEndVerticalIcon,
  'al-top': AlignStartHorizontalIcon, 'al-vcenter': AlignVerticalCenterIcon, 'al-bottom': AlignEndHorizontalIcon,
  'al-dist-h': DistributeHorizontalCenterIcon, 'al-dist-v': DistributeVerticalCenterIcon,
};

export function Icon({ name, size = 16, className = '', strokeWidth = 1.6 }) {
  const ic = I[name];
  if (!ic) return null;
  return <HugeiconsIcon icon={ic} size={size} strokeWidth={strokeWidth} color="currentColor" className={'ic ' + className} aria-hidden="true" />;
}
