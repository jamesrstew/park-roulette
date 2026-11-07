import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Park Roulette",
    short_name: "Park Roulette",
    description:
      "Spin the crayon wheel, find a playground. Every playground in Central Oregon, one spin at a time.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#fffaf0",
    theme_color: "#fffaf0",
    categories: ["kids", "lifestyle", "travel"],
    icons: [
      { src: "/icon/192", sizes: "192x192", type: "image/png" },
      { src: "/icon/512", sizes: "512x512", type: "image/png" },
      {
        src: "/icon/maskable",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
