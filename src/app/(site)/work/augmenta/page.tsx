import { augmentaCaseStudy } from "@/data/augmenta-case-study";
import { CaseStudyPage } from "@/components/case-study";
import type { Metadata } from "next";

export const revalidate = 86400;

export const metadata: Metadata = {
  title: "Augmenta Education case study",
  description: augmentaCaseStudy.description,
  alternates: {
    canonical: "/work/augmenta",
  },
  openGraph: {
    type: "article",
    title: "Augmenta Education case study",
    description: augmentaCaseStudy.ogDescription,
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

export default function AugmentaCaseStudy() {
  return <CaseStudyPage data={augmentaCaseStudy} />;
}
