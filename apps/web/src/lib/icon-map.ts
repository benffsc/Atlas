/**
 * Icon Map — maps string keys to Lucide icon components.
 *
 * Used by sidebar nav items (stored in DB as string icon names)
 * and any component that needs to resolve an icon by name.
 *
 * Import: `import { ICON_MAP, type IconName } from "@/lib/icon-map"`
 */
import {
  Home,
  Map,
  Inbox,
  ClipboardList,
  Hospital,
  Snail,
  Wrench,
  Cat,
  Users,
  MapPin,
  Search,
  Radio,
  BarChart3,
  Sparkles,
  CalendarDays,
  Settings,
  LayoutDashboard,
  Upload,
  ListChecks,
  Mail,
  FileText,
  Send,
  UserCog,
  Building2,
  FormInput,
  FileStack,
  Leaf,
  ShieldCheck,
  Palette,
  Tag,
  Paintbrush,
  Ban,
  Flag,
  Compass,
  Shield,
  Code2,
  BookOpen,
  Pencil,
  Plus,
  Printer,
  Eye,
  Baby,
  ScrollText,
  Thermometer,
  Briefcase,
  SquareKanban,
  Bot,
  CircleDot,
  Telescope,
  TrendingUp,
  ScanBarcode,
  List,
  PackagePlus,
  Camera,
  X,
  Keyboard,
  CheckCircle,
  Share,
  Phone,
  Smartphone,
  Monitor,
  Copy,
  ExternalLink,
  Tablet,
  ArrowRight,
  ChevronDown,
  ChevronRight,
  Zap,
  Gauge,
  HelpCircle,
  HeartPulse,
  FlaskConical,
  GraduationCap,
  MessageSquare,
  Activity,
  Grid2X2,
  DatabaseZap,
  GitMerge,
  AlertTriangle,
  Crosshair,
  Layers,
  FileSearch,
  Clock,
  LogOut,
  LogIn,
  ArrowRightLeft,
  Archive,
  User,
  Calendar,
  Check,
  AlertCircle,
  RotateCcw,
  Target,
  Building,
  Heart,
  Box,
  Lock,
  Scissors,
  Utensils,
  type LucideIcon,
} from "lucide-react";

export const ICON_MAP: Record<string, LucideIcon> = {
  // Operations
  home: Home,
  map: Map,
  inbox: Inbox,
  "clipboard-list": ClipboardList,
  hospital: Hospital,
  snail: Snail,
  wrench: Wrench,
  briefcase: Briefcase,

  // Records
  cat: Cat,
  users: Users,
  "map-pin": MapPin,
  search: Search,

  // Beacon
  radio: Radio,
  "bar-chart": BarChart3,
  sparkles: Sparkles,
  "calendar-days": CalendarDays,
  thermometer: Thermometer,
  "trending-up": TrendingUp,
  telescope: Telescope,

  // Admin - Dashboard
  "layout-dashboard": LayoutDashboard,
  upload: Upload,
  "list-checks": ListChecks,

  // Admin - Beacon
  "circle-dot": CircleDot,

  // Admin - Email
  mail: Mail,
  "file-text": FileText,
  send: Send,

  // Admin - Settings
  "user-cog": UserCog,
  "building-2": Building2,
  "form-input": FormInput,
  "file-stack": FileStack,
  leaf: Leaf,
  "shield-check": ShieldCheck,
  settings: Settings,
  palette: Palette,
  tag: Tag,
  paintbrush: Paintbrush,
  ban: Ban,
  flag: Flag,
  compass: Compass,
  shield: Shield,

  // Admin - Developer
  "code-2": Code2,
  "book-open": BookOpen,
  pencil: Pencil,
  bot: Bot,

  // Actions
  plus: Plus,
  printer: Printer,
  eye: Eye,
  baby: Baby,
  "scroll-text": ScrollText,
  "square-kanban": SquareKanban,

  // Kiosk
  "scan-barcode": ScanBarcode,
  list: List,
  "package-plus": PackagePlus,
  camera: Camera,
  x: X,
  keyboard: Keyboard,
  "check-circle": CheckCircle,
  share: Share,
  phone: Phone,
  smartphone: Smartphone,
  monitor: Monitor,
  copy: Copy,
  "external-link": ExternalLink,
  tablet: Tablet,
  "arrow-right": ArrowRight,

  // Sidebar collapse
  "chevron-down": ChevronDown,
  "chevron-right": ChevronRight,

  // Hub pages & dashboard
  zap: Zap,
  gauge: Gauge,
  "help-circle": HelpCircle,
  "heart-pulse": HeartPulse,
  "flask-conical": FlaskConical,
  "graduation-cap": GraduationCap,
  "message-square": MessageSquare,
  activity: Activity,
  "grid-2x2": Grid2X2,
  "database-zap": DatabaseZap,
  "git-merge": GitMerge,
  "alert-triangle": AlertTriangle,
  crosshair: Crosshair,
  layers: Layers,
  "file-search": FileSearch,
  clock: Clock,

  // Equipment kiosk actions + checkout form
  "log-out": LogOut,
  "log-in": LogIn,
  "arrow-right-left": ArrowRightLeft,
  tool: Wrench,
  archive: Archive,
  user: User,
  calendar: Calendar,
  check: Check,
  "alert-circle": AlertCircle,
  "rotate-ccw": RotateCcw,
  target: Target,
  building: Building,
  heart: Heart,
  box: Box,
  lock: Lock,
  scissors: Scissors,
  utensils: Utensils,
};

export type IconName = keyof typeof ICON_MAP;

/**
 * Resolve an icon string to a Lucide component.
 * Returns undefined if not found (caller should show emoji fallback).
 */
export function resolveIcon(name: string | undefined): LucideIcon | undefined {
  if (!name) return undefined;
  return ICON_MAP[name];
}
