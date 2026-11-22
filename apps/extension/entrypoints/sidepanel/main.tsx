// Must stay first: it configures zod before any schema is created.
import "@/lib/zod-config";
import "@/components/pages/pages.css";

import { mountPage } from "@/components/pages/mount";
import { SidePanelApp } from "@/components/pages/sidepanel/SidePanelApp";

mountPage(<SidePanelApp />);
