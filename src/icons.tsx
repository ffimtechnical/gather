/** One place that maps every concept to its icon (lucide line icons). */
import {
  Ban, Church, Cross, DoorClosed, DoorOpen, HandHeart, Heart, HeartHandshake, Megaphone, MessageCircle,
  Repeat, Shield, ShieldCheck, StickyNote, User as UserIcon, Users, type LucideIcon, CalendarCheck,
} from 'lucide-react';
import type { Role, TaskAction, VisitKind } from '../shared/model';

export const OUTCOME_ICON: Record<string, LucideIcon> = {
  prayed: HandHeart,
  good_chat: MessageCircle,
  invited: Church,
  not_home: DoorClosed,
  gave_life: Cross,
  came_to_church: CalendarCheck,
  needs_help: HeartHandshake,
  not_interested: Ban,
};

export const KIND_ICON: Record<VisitKind, LucideIcon> = {
  evangelism: Megaphone,
  follow_up: Repeat,
  member_care: Heart,
  other: StickyNote,
};

export const ACTION_ICON: Record<TaskAction, LucideIcon> = {
  first_visit: DoorOpen,
  follow_up: Repeat,
  member_care: Heart,
  invite: Church,
  pray: HandHeart,
  other: StickyNote,
};

export const ROLE_ICON: Record<Role, LucideIcon> = {
  admin: ShieldCheck,
  pastor: Shield,
  member: UserIcon,
};

export { Users };
export const ICON = { size: 20, strokeWidth: 1.75 } as const;
export const ICON_SM = { size: 16, strokeWidth: 1.9 } as const;
