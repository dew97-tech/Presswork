import { bridgeBooksCaseStudy } from "@/data/bridgebooks-case-study";
import { CaseStudyPage } from "@/components/case-study";
import type { Metadata } from "next";

export const revalidate = 86400;

export const metadata: Metadata = {
  title: "BridgeBooks System case study",
  description: bridgeBooksCaseStudy.description,
  alternates: {
    canonical: "/work/bridgebooks",
  },
  openGraph: {
    type: "article",
    title: "BridgeBooks System case study",
    description: bridgeBooksCaseStudy.ogDescription,
    images: [
      {
        url: "/og.png",
        width: 1200,
        height: 630,
        alt: "David Dew Mallick, Intermediate Software Engineer",
      },
    ],
  },
};

export default function BridgeBooksCaseStudy() {
  return <CaseStudyPage data={bridgeBooksCaseStudy} />;
}
