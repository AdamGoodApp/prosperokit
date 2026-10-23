import { Text, View } from '@prosperokit/react'
import { Bell, CircleAlert, Gamepad2, Inbox, Settings, Wifi } from 'lucide'
import { useState } from 'react'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { AspectRatio } from '@/components/ui/aspect-ratio'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from '@/components/ui/carousel'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import { Kbd } from '@/components/ui/kbd'
import { Menubar, MenubarItem } from '@/components/ui/menubar'
import {
  NavigationMenu,
  NavigationMenuContent,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuList,
  NavigationMenuTrigger,
} from '@/components/ui/navigation-menu'
import { Pagination } from '@/components/ui/pagination'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
} from '@/components/ui/sidebar'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import {
  createDataTableColumns,
  DataTable,
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Code, H1, H2, H3, H4, Lead, Muted, P } from '@/components/ui/typography'
import { UiIcon } from '../primitives'
import { colors } from '../theme'
import type { GalleryEntry } from './types'

interface Game {
  id: string
  title: string
  genre: string
  hours: number
}

const games: Game[] = [
  { id: 'returnal', title: 'Returnal', genre: 'Roguelike', hours: 30 },
  { id: 'astro', title: 'Astro Bot', genre: 'Platformer', hours: 12 },
  { id: 'ratchet', title: 'Ratchet & Clank', genre: 'Action', hours: 20 },
  { id: 'demons', title: "Demon's Souls", genre: 'RPG', hours: 45 },
]

const gameColumnHelper = createDataTableColumns<Game>()
const gameColumns = gameColumnHelper.columns([
  gameColumnHelper.accessor('title', { header: 'Title' }),
  gameColumnHelper.accessor('genre', { header: 'Genre' }),
  gameColumnHelper.accessor('hours', { header: 'Hours played' }),
])

function ScrollSample() {
  return (
    <ScrollArea className="h-[320px] w-[720px]">
      <View className="gap-2 pr-4">
        {Array.from({ length: 16 }, (_, i) => `Entry ${i + 1}`).map((label) => (
          <Text key={label} className="text-base text-ps-text">
            {label}
          </Text>
        ))}
      </View>
    </ScrollArea>
  )
}

function SidebarSample() {
  const [page, setPage] = useState('games')
  return (
    <SidebarProvider className="h-[560px]">
      <Sidebar>
        <SidebarHeader>
          <Text className="text-xl font-semibold text-ps-text">Settings</Text>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel>System</SidebarGroupLabel>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  icon={Gamepad2}
                  isActive={page === 'games'}
                  onPress={() => setPage('games')}
                  testID="gallery-sidebar-games"
                >
                  Games
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  icon={Wifi}
                  isActive={page === 'network'}
                  onPress={() => setPage('network')}
                >
                  Network
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  icon={Bell}
                  isActive={page === 'notifications'}
                  onPress={() => setPage('notifications')}
                >
                  Notifications
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroup>
        </SidebarContent>
        <SidebarFooter>
          <SidebarMenuButton icon={Settings}>Preferences</SidebarMenuButton>
        </SidebarFooter>
      </Sidebar>
      <SidebarInset>
        <H3>{page}</H3>
      </SidebarInset>
    </SidebarProvider>
  )
}

export const layoutEntries: GalleryEntry[] = [
  {
    name: 'accordion',
    section: 'Layout',
    element: (
      <Accordion type="single" collapsible defaultValue="controls">
        <AccordionItem value="controls">
          <AccordionTrigger>Controls</AccordionTrigger>
          <AccordionContent>
            <Text className="text-base text-ps-text-muted">Cross selects, Circle goes back.</Text>
          </AccordionContent>
        </AccordionItem>
        <AccordionItem value="network">
          <AccordionTrigger>Network</AccordionTrigger>
          <AccordionContent>
            <Text className="text-base text-ps-text-muted">Connected over Wi-Fi.</Text>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    ),
  },
  {
    name: 'collapsible',
    section: 'Layout',
    element: (
      <Collapsible defaultOpen>
        <CollapsibleTrigger>Advanced options</CollapsibleTrigger>
        <CollapsibleContent className="px-6">
          <Text className="text-base text-ps-text-muted">Only mounted while open.</Text>
        </CollapsibleContent>
      </Collapsible>
    ),
  },
  {
    name: 'alert',
    section: 'Feedback',
    element: (
      <View className="gap-4">
        <Alert icon={Bell}>
          <AlertTitle>Heads up</AlertTitle>
          <AlertDescription>A system update is ready to install.</AlertDescription>
        </Alert>
        <Alert variant="destructive" icon={CircleAlert}>
          <AlertTitle>Connection lost</AlertTitle>
          <AlertDescription>Check the network cable and try again.</AlertDescription>
        </Alert>
      </View>
    ),
  },
  {
    name: 'aspect-ratio',
    section: 'Layout',
    element: (
      <View className="w-[480px]">
        <AspectRatio
          ratio={16 / 9}
          className="items-center justify-center rounded-lg bg-ps-surface"
        >
          <Text className="text-base text-ps-text">16 : 9</Text>
        </AspectRatio>
      </View>
    ),
  },
  {
    name: 'avatar',
    section: 'Feedback',
    element: (
      <View className="flex-row items-center gap-4">
        <Avatar>
          <AvatarImage source="app0://assets/avatar.png" />
          <AvatarFallback>AG</AvatarFallback>
        </Avatar>
        <Avatar size="lg">
          <AvatarFallback>PK</AvatarFallback>
        </Avatar>
        <Avatar size="sm">
          <AvatarImage source={{ uri: 'app0://assets/missing.png' }} />
          <AvatarFallback>?</AvatarFallback>
        </Avatar>
      </View>
    ),
  },
  {
    name: 'badge',
    section: 'Feedback',
    element: (
      <View className="flex-row flex-wrap items-center gap-3">
        <Badge>New</Badge>
        <Badge variant="secondary">Beta</Badge>
        <Badge variant="destructive">Offline</Badge>
        <Badge variant="outline">Draft</Badge>
      </View>
    ),
  },
  {
    name: 'breadcrumb',
    section: 'Navigation',
    element: (
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink>Home</BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbLink>Settings</BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>Network</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>
    ),
  },
  {
    name: 'card',
    section: 'Layout',
    element: (
      <View className="flex-row gap-8 p-4">
        <Card className="w-[480px]">
          <CardHeader>
            <CardTitle>Storage</CardTitle>
            <CardDescription>825 GB internal SSD</CardDescription>
          </CardHeader>
          <CardContent>
            <Text className="text-base text-ps-text">412 GB free</Text>
          </CardContent>
          <CardFooter>
            <Button size="sm" variant="secondary">
              Manage
            </Button>
          </CardFooter>
        </Card>
        <Card focusable className="w-[360px]" testID="gallery-card-focusable">
          <CardHeader>
            <CardTitle>Focusable card</CardTitle>
            <CardDescription>Ring and scale on focus</CardDescription>
          </CardHeader>
        </Card>
      </View>
    ),
  },
  {
    name: 'carousel',
    section: 'Layout',
    element: (
      <Carousel className="w-[1200px]">
        <CarouselContent>
          {['Returnal', 'Astro Bot', 'Ratchet & Clank', "Demon's Souls", 'Gran Turismo 7'].map(
            (title) => (
              <CarouselItem key={title}>
                <View className="flex-1 items-center justify-center">
                  <Text className="text-xl font-semibold text-ps-text">{title}</Text>
                </View>
              </CarouselItem>
            ),
          )}
        </CarouselContent>
        <View className="flex-row gap-4">
          <CarouselPrevious />
          <CarouselNext />
        </View>
      </Carousel>
    ),
  },
  {
    name: 'empty',
    section: 'Feedback',
    element: (
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <UiIcon icon={Inbox} size={48} color={colors.textMuted} />
          </EmptyMedia>
          <EmptyTitle>No downloads</EmptyTitle>
          <EmptyDescription>Games you download will show up here.</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button variant="secondary">Browse store</Button>
        </EmptyContent>
      </Empty>
    ),
  },
  {
    name: 'kbd',
    section: 'Typography',
    element: (
      <View className="flex-row flex-wrap items-center gap-8">
        <Kbd button="cross">Select</Kbd>
        <Kbd button="circle">Back</Kbd>
        <Kbd button="l1">Previous tab</Kbd>
        <Kbd button="r1">Next tab</Kbd>
      </View>
    ),
  },
  {
    name: 'menubar',
    section: 'Navigation',
    element: (
      <Menubar defaultValue="games">
        <MenubarItem value="games">Games</MenubarItem>
        <MenubarItem value="media">Media</MenubarItem>
      </Menubar>
    ),
  },
  {
    name: 'navigation-menu',
    section: 'Navigation',
    element: (
      <NavigationMenu defaultValue="library">
        <NavigationMenuList>
          <NavigationMenuItem value="library">
            <NavigationMenuTrigger>Library</NavigationMenuTrigger>
            <NavigationMenuContent>
              <NavigationMenuLink>All games</NavigationMenuLink>
              <NavigationMenuLink>Recently played</NavigationMenuLink>
            </NavigationMenuContent>
          </NavigationMenuItem>
          <NavigationMenuItem value="store">
            <NavigationMenuTrigger>Store</NavigationMenuTrigger>
            <NavigationMenuContent>
              <NavigationMenuLink>Deals</NavigationMenuLink>
              <NavigationMenuLink>New releases</NavigationMenuLink>
            </NavigationMenuContent>
          </NavigationMenuItem>
        </NavigationMenuList>
      </NavigationMenu>
    ),
  },
  {
    name: 'pagination',
    section: 'Navigation',
    element: <Pagination defaultPage={4} pageCount={12} />,
  },
  { name: 'scroll-area', section: 'Layout', element: <ScrollSample /> },
  {
    name: 'separator',
    section: 'Layout',
    element: (
      <View className="w-[480px] gap-4">
        <Text className="text-base text-ps-text">Above</Text>
        <Separator />
        <View className="h-[48px] flex-row items-center gap-4">
          <Text className="text-base text-ps-text">Left</Text>
          <Separator orientation="vertical" />
          <Text className="text-base text-ps-text">Right</Text>
        </View>
      </View>
    ),
  },
  { name: 'sidebar', section: 'Navigation', element: <SidebarSample /> },
  {
    name: 'skeleton',
    section: 'Feedback',
    element: (
      <View className="flex-row items-center gap-4">
        <Skeleton className="h-[64px] w-[64px] rounded-full" />
        <View className="gap-3">
          <Skeleton className="h-[24px] w-[360px]" />
          <Skeleton className="h-[24px] w-[240px]" />
        </View>
      </View>
    ),
  },
  {
    name: 'spinner',
    section: 'Feedback',
    element: (
      <View className="flex-row items-center gap-6">
        <Spinner size={32} />
        <Spinner />
        <Spinner size={72} />
      </View>
    ),
  },
  {
    name: 'table',
    section: 'Data',
    element: (
      <Table>
        <TableCaption>Recently played</TableCaption>
        <TableHeader>
          <TableRow>
            <TableHead>Title</TableHead>
            <TableHead>Genre</TableHead>
            <TableHead>Hours</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {games.map((game) => (
            <TableRow key={game.id} focusable>
              <TableCell>{game.title}</TableCell>
              <TableCell>{game.genre}</TableCell>
              <TableCell>{game.hours}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    ),
  },
  {
    name: 'data-table',
    section: 'Data',
    element: <DataTable columns={gameColumns} data={games} getRowId={(game) => game.id} />,
  },
  {
    name: 'tabs',
    section: 'Navigation',
    element: (
      <Tabs defaultValue="games">
        <TabsList>
          <TabsTrigger value="games">Games</TabsTrigger>
          <TabsTrigger value="media">Media</TabsTrigger>
          <TabsTrigger value="store">Store</TabsTrigger>
        </TabsList>
        <TabsContent value="games">
          <Text className="text-base text-ps-text">Your game library (L1 / R1 switch tabs).</Text>
        </TabsContent>
        <TabsContent value="media">
          <Text className="text-base text-ps-text">Music, video and screenshots.</Text>
        </TabsContent>
        <TabsContent value="store">
          <Text className="text-base text-ps-text">Browse deals and new releases.</Text>
        </TabsContent>
      </Tabs>
    ),
  },
  {
    name: 'typography',
    section: 'Typography',
    element: (
      <View className="gap-3">
        <H1>Heading 1</H1>
        <H2>Heading 2</H2>
        <H3>Heading 3</H3>
        <H4>Heading 4</H4>
        <Lead>Lead paragraph introducing the page.</Lead>
        <P>Body text for regular paragraphs.</P>
        <Muted>Muted secondary text.</Muted>
        <View className="flex-row">
          <Code>prosperokit dev</Code>
        </View>
      </View>
    ),
  },
]
