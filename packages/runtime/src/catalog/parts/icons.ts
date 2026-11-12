// The AppSpec ICONS names mapped to lucide-react glyphs (UI only; the pure files keep just the names).
import {
  BarChart3, Box, Briefcase, Calendar, Clipboard, File, Folder, Heart, House, Inbox, List, Map, Settings, Star, Table, Tag,
  Truck, User, Users, Wrench,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { IconName } from '../../../../../src/catalog/enums.ts';

export const PART_ICONS: Record<IconName, LucideIcon> = {
  home: House,
  list: List,
  table: Table,
  users: Users,
  user: User,
  box: Box,
  calendar: Calendar,
  chart: BarChart3,
  clipboard: Clipboard,
  file: File,
  folder: Folder,
  tag: Tag,
  star: Star,
  briefcase: Briefcase,
  truck: Truck,
  wrench: Wrench,
  settings: Settings,
  inbox: Inbox,
  map: Map,
  heart: Heart,
};
