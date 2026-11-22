// Must stay first: it configures zod before any schema is created.
import "@/lib/zod-config";
import "@/components/pages/pages.css";

import { mountPage } from "@/components/pages/mount";
import { OptionsApp } from "@/components/pages/options/OptionsApp";

mountPage(<OptionsApp />);
