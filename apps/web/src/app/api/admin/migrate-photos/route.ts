import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { supabase, MEDIA_BUCKET } from "@/lib/supabase";

// V1 → V2 Cat Photo Migration
// Downloads photos from V1 public storage and uploads to V2

const V1_SUPABASE_URL = "https://tpjllrfpdlkenbapvpko.supabase.co";

// V1 cat_id → V2 cat_id mapping (from microchip match)
const MAPPING: Record<string, string> = {
  "3855b317-904e-4ef0-b827-8bf0c75b1cbc": "54b4bec8-d924-4d73-b4c8-4c64ae6b7582",
  "e8d618ee-44fe-4390-97b9-121a6487af4a": "394cb9cf-4d23-4c42-bfb0-4e42a16bf447",
  "460be583-716a-4e85-8aaf-807c6827d0c5": "8842d745-46fa-4ad3-a602-4ce9b1611ba4",
  "03b96f0d-cb10-45ac-baa7-17751abd1986": "e980c42e-a103-4e2d-ad55-06dacb214651",
  "246825e4-c1ce-404c-825a-d0fa9c5b4e40": "cd0b0cf7-3984-48f0-9f3f-9e4a085171f7",
  "ac6c36b8-c669-4678-9c78-fb8dd8e881a4": "b6d38b57-1d12-4b89-a3ab-5256686cec56",
  "6db7d156-04dd-4d85-9800-bff7bfa86432": "9ddb7b7b-1e87-45e9-84fc-c3eadfd170bd",
  "ec4be000-7393-4618-a49d-72e9a2715d80": "ff88f309-fee9-494d-9f4b-12e17d57d406",
  "2748c814-d928-4bc9-9932-3cfd3461d94b": "39d64d52-5103-4a4a-a44a-6d0653f89fe0",
  "c6e94573-cf0c-4743-83b6-51270f29daba": "7346a863-4c6b-4a37-b368-91669e712d16",
  "51f9f9b2-3b81-4e81-92ff-7dec3cbeca2c": "366f8993-c78f-4019-a076-b2f9b8c3bf8e",
  "e3248771-1fad-446d-8624-8f3c1f230083": "bb70e140-3cd9-4b32-80a3-fd54d34427a6",
  "59f6c186-2b36-497e-9cf0-a4019b2883ee": "a8197204-a8a3-42c4-a52f-818baba22f28",
  "499f987a-022e-4686-ba86-9bfa62e9931a": "ab23bf85-12d1-4886-9dd2-f1d2d0baff48",
  "dbf2e643-426d-479e-85f1-9fe3d1a3c9a0": "f9afec0e-c797-497e-bece-9b78d4ee0c72",
  "0b5ab620-e18a-4b1d-b8a9-3073f608bc9d": "f0f368b5-c8de-4087-8019-2bf23d365660",
  "903e7449-fc51-442a-bfe9-0ec5e2e90134": "ba597239-5c6c-4d14-818c-a494f88cd554",
  "564e1981-4894-4254-9de5-0e72b70224c6": "4227e01e-0ae0-4866-bac1-2666e60d5b95",
  "b5da5b4b-b229-4c87-bceb-0097306c3e7d": "5c9ae2cf-f9fb-4129-9189-9cda3a44dccf",
  "6042690c-2174-41ea-898e-a36a0a6952c8": "21e7c778-332d-46df-a53b-3d617c9a8b4e",
  "456662aa-f615-459e-8059-199d78d9cac9": "8fcccff9-b38b-45b9-91b6-ed07fec561c1",
  "52273dee-138c-4f44-8e05-affa26ed89b1": "b58721ac-f130-47a4-bc54-90d3759086a3",
  "c83bd161-5dda-45e9-803e-ecb6bb7afe14": "b37a88ac-3c21-41ea-ba0f-f219151858fe",
  "570aa879-e724-4dbb-8b19-84fda2b86161": "5fcf3c55-709d-4be3-ad60-5e340eb2cddb",
  "4292955f-1706-418d-81f0-0cf81b2bd7cd": "9c46d86b-0ea0-40d5-ad9f-239783d38cb2",
  "9fc5e6d5-2726-499e-bd63-ce3bccb9f8ef": "59b2829d-fdda-4dfd-a534-88ba3f531d92",
  "6ea80950-bc6b-4d0c-afaf-9dd641ec917c": "3cc380ce-2c82-468e-bc68-1cf905a1b809",
  "17b6faf1-21ae-4509-a4ab-fe1a30acfd9a": "2bb7e3fe-a56d-41a8-9f36-9e25a06844b3",
  "829eceea-8ce2-445e-9e9a-65c119944510": "7d448ca9-5a1b-4b91-a133-18c2832f7bc8",
  "1b027810-e091-4e6a-ab74-9b332f5119cf": "992727fe-c755-42dc-8d92-91a63e0fc779",
  "235388f0-f4c2-409d-87a3-7f60a024aa94": "6a18440f-67e4-4b43-8b0e-9afdf1e5f874",
  "bd664b6c-55bc-4498-abd8-5737f82cf616": "4dc234c9-8f7f-4618-b9d9-91c69e48dbc5",
  "141b1de6-fa6a-46ad-afba-bcd320dfe822": "442c2e12-485b-41d0-b1b3-bf93fbfc1f84",
  "05cb110b-2312-4ecf-9d64-2613f2369c6d": "4770993b-3373-4cc5-a3c2-642e7cce8f0d",
  "72293926-b398-49aa-94fb-f7b1451498f7": "e89993fd-cec3-4c57-8e5b-2904a26928e5",
  "ca4f5283-7d83-4342-8a12-4f104eb09705": "747f726d-846e-4be9-ad9b-0856a651e2aa",
  "1af0a61b-14b6-4911-a19b-99f781a5bd10": "57111a7d-4140-44ad-a664-c51668bd39da",
  "f5c0f61c-4744-4049-b098-358ee5cb1c33": "d74431fc-f223-4c26-a2de-6ab9069aa9c9",
  "df9d02b3-1199-4f64-9e76-299577c645c5": "c250b287-a4c3-45a6-bd20-14d9c01cef06",
  "261742cf-675b-4a87-bd46-d8f0130b2929": "a1d53922-8711-4695-9e9b-991d93d1d558",
  "aa0930aa-a71e-433a-819d-6b26f169ff07": "ca68ad5e-2064-4bf4-bf65-110146821aea",
  "049fa64f-4fa1-4d21-a779-22f5622a1d7e": "17eadfc5-7536-4d8d-ba67-7141c2338996",
  "55cd67ad-dc66-4ec7-bf39-292fb6bffc6c": "ac0f20a4-20c7-47ee-9c5e-1ef6a6fcf32e",
  "6572151a-4271-4254-ba61-d7afc089ab8f": "6e4e23d3-bce1-4358-84c4-a0393618dac8",
  "6caf7c91-169b-459a-86ee-16523ab0f804": "fe8def39-64f9-4ff5-aaf3-eb61af59b677",
  "e926ac61-0d6f-4cc7-969d-899bbdbb19ed": "28829280-399b-4345-80ee-7995d6603e26",
  "cd06eaea-bc49-4dba-9c4e-fae3f006fe31": "84559421-c01c-4f27-8668-aee063691b4a",
  "f3cebdf9-7e0a-4e39-bbdf-7f3fdd5368fd": "67c7dafc-3dfa-48b6-b337-c49fa562297b",
  "3c68e0e2-bf38-42ac-8f3e-eed2bfc0d24d": "1a606c43-ca5f-41e6-8750-896891b3a7f2",
  "ecae6873-7254-4485-82ac-a7d56c8fdc12": "b02172f1-6a59-439e-9129-a83228d16c70",
  "0431456f-5a1b-4a05-a5fb-662f20bfd838": "473fd62a-cde8-4097-8bcd-2c4b0657b188",
  "a7ddd6e5-162f-4d39-b0b4-355d4f950423": "54eac3eb-34c2-484e-9195-ab059c29a2a1",
  "d12f7735-84b4-455c-b025-379579e52185": "87cc0d30-5786-42b7-bbd6-5c812e71ace3",
  "3412876f-7c25-4bf6-a4ba-bdf49cf44417": "88d41f14-b767-489e-bd97-3f5902bfe816",
  "ffaddb55-9cd8-4751-991b-4c7bdc820215": "27dd939f-764c-4c73-acd9-98602298d547",
  "3d99e11d-9c8c-42d2-9829-777748a3259d": "72c2ea3a-1569-416a-b6b1-52a2b59070c7",
  "be078d63-78b3-4a46-b0ac-e39a72dd6351": "3eb0f1f4-f4a9-46a3-b926-c9bb4ff1876e",
  "237b3f00-b852-4267-bcf6-7fefa9fd3da7": "1ba08b29-aaba-4378-8d96-a7234c99a2cc",
  "d53e2923-8502-44e8-b27a-8ca3838f0399": "915f0a2c-8f60-47a5-be10-f5cb39286c40",
  "9308c297-14ca-48f4-ba6d-bb62b3b2a079": "3c95e6fb-2426-47b5-ac32-cf785cfa7ae4",
  "a3e29de7-0055-43b8-b4bc-5ea78764c86c": "39b59b57-25ac-4e8a-a241-9f2ffb3fa266",
  "7d821707-bd06-492a-861d-5fb842ce1803": "ba2e5b02-d6d9-4bc4-8022-2b710c34dbf8",
  "9bbf6160-1a92-4ad6-9424-adf3c4cd5b2e": "8d50ed75-c53d-41b6-a04b-7c6bacea0267",
  "400258c3-4446-4483-8604-6f0fe197e94e": "0717e1bf-b95d-4149-8ae8-abf1a042eedf",
  "e1a55dba-9eec-4967-b2a3-550d0dffb0a3": "71dd907c-b4ec-4a2f-a94c-a1cbb494327c",
  "819e9a7b-0b36-43e4-bce2-655ca4956b61": "4729c4c9-eedf-47c7-b201-9d448492f171",
  "bab7c744-695d-49be-8ca0-8c477c741d57": "cc295dfe-7589-45a0-b75c-62aec6325061",
  "2d8ebd5e-1b1e-4421-aa45-efa11538d24c": "3d274005-8ebd-43ad-a435-9bd0ffc3dca1",
  "5f7d1bcb-6c6f-4c7b-8a38-2839131d958e": "32ee8660-4656-414e-abd7-e52ebc84235c",
  "87f6d30c-4f15-4640-ab0c-a0ca420057dc": "a4292a63-5e25-403c-bc62-fa400ae34687",
  "f2b4f153-0e45-4b30-9b83-696e9e7cc5f6": "c54d768d-d97b-4ceb-8bfb-57814b64744a",
  "635bc47a-d439-4afa-85b6-35155855b129": "13b8599d-f334-4773-83a1-7c21c5a2306b",
  "8efb74ba-edda-492c-bb77-3e2a473f06da": "cb7687a2-51b4-4cfe-9e71-e503d1c4cc68",
  "936abc63-e5a0-4e88-991c-315b14cb2090": "319b9bc4-e02e-4b81-a1e0-1d00b9b43951",
  "64d91d26-d8d3-48ed-962b-d54d879cfdec": "4575c1b3-2342-48f2-a952-2be094f73ea7",
  "3ac02240-0cd4-46a4-ac48-aa9fb60f3f9a": "90942904-fcb4-4070-88ea-b4b21487483e",
  "d6ed7c12-1c20-4296-8d2c-64a3bece1ab2": "6bb61dfe-f919-4aee-8c81-19823a15907f",
  "e9615084-6d90-45c5-be8b-719acf203179": "7c506161-0bcc-4de3-ba5c-b50fcf326f85",
  "0a11ac55-eb0c-44d1-b7f7-baf4892ec68a": "333a30cb-1a5e-4fb1-a1fe-77adfbd174f1",
};

// V1 photos list (from database query)
const V1_PHOTOS = [
  "cats/03b96f0d-cb10-45ac-baa7-17751abd1986/03b96f0d-cb10-45ac-baa7-17751abd1986_1770399077703_fc977764.jpg",
  "cats/03b96f0d-cb10-45ac-baa7-17751abd1986/03b96f0d-cb10-45ac-baa7-17751abd1986_1770399078916_c5369eb0.jpg",
  "cats/03b96f0d-cb10-45ac-baa7-17751abd1986/03b96f0d-cb10-45ac-baa7-17751abd1986_1770399080397_526cf2ab.jpg",
  // ... truncated for brevity - will be populated from db query
];

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST() {
  if (!supabase) {
    return NextResponse.json(
      { error: "Supabase not configured" },
      { status: 500 }
    );
  }

  const results = {
    migrated: 0,
    skipped: 0,
    errors: 0,
    details: [] as Array<{ v1Path: string; v2Path: string; status: string }>,
  };

  // Fetch photos from V1 database
  const v1PhotoPaths = await fetchV1Photos();

  for (const v1Path of v1PhotoPaths) {
    const parts = v1Path.split("/");
    if (parts.length !== 3) continue;

    const v1CatId = parts[1];
    const filename = parts[2];
    const v2CatId = MAPPING[v1CatId];

    if (!v2CatId) {
      results.skipped++;
      results.details.push({ v1Path, v2Path: "", status: "no_mapping" });
      continue;
    }

    const v2Path = `cats/${v2CatId}/${filename}`;

    try {
      // Download from V1 public URL
      const downloadUrl = `${V1_SUPABASE_URL}/storage/v1/object/public/request-media/${v1Path}`;
      const response = await fetch(downloadUrl);

      if (!response.ok) {
        results.errors++;
        results.details.push({ v1Path, v2Path, status: `download_failed_${response.status}` });
        continue;
      }

      const blob = await response.blob();
      const buffer = Buffer.from(await blob.arrayBuffer());
      const contentType = filename.endsWith(".png") ? "image/png" : "image/jpeg";

      // Upload to V2
      const { error } = await supabase.storage
        .from(MEDIA_BUCKET)
        .upload(v2Path, buffer, {
          contentType,
          upsert: true,
        });

      if (error) {
        results.errors++;
        results.details.push({ v1Path, v2Path, status: `upload_failed: ${error.message}` });
      } else {
        results.migrated++;
        results.details.push({ v1Path, v2Path, status: "success" });
      }
    } catch (err) {
      results.errors++;
      results.details.push({ v1Path, v2Path, status: `error: ${err}` });
    }
  }

  return NextResponse.json(results);
}

// Fetch V1 photo paths - this list is pre-computed from the V1 database
async function fetchV1Photos(): Promise<string[]> {
  // Since we can't query V1 database from here, use the pre-computed list
  // This was generated from: SELECT name FROM storage.objects WHERE bucket_id = 'request-media' AND name LIKE 'cats/%'

  // For now, return the hardcoded list from the CSV data
  const photos = [
    "cats/03b96f0d-cb10-45ac-baa7-17751abd1986/03b96f0d-cb10-45ac-baa7-17751abd1986_1770399077703_fc977764.jpg",
    "cats/03b96f0d-cb10-45ac-baa7-17751abd1986/03b96f0d-cb10-45ac-baa7-17751abd1986_1770399078916_c5369eb0.jpg",
    "cats/03b96f0d-cb10-45ac-baa7-17751abd1986/03b96f0d-cb10-45ac-baa7-17751abd1986_1770399080397_526cf2ab.jpg",
    "cats/049fa64f-4fa1-4d21-a779-22f5622a1d7e/049fa64f-4fa1-4d21-a779-22f5622a1d7e_1770399504752_84fb63ca.jpg",
    "cats/049fa64f-4fa1-4d21-a779-22f5622a1d7e/049fa64f-4fa1-4d21-a779-22f5622a1d7e_1770399506151_dbfeefd5.jpg",
    "cats/05cb110b-2312-4ecf-9d64-2613f2369c6d/05cb110b-2312-4ecf-9d64-2613f2369c6d_1770151994188_79f59d6c.png",
    "cats/05cb110b-2312-4ecf-9d64-2613f2369c6d/05cb110b-2312-4ecf-9d64-2613f2369c6d_1770152011219_a9b8a63a.png",
    "cats/0a11ac55-eb0c-44d1-b7f7-baf4892ec68a/0a11ac55-eb0c-44d1-b7f7-baf4892ec68a_1770315626167_d0b31f21.jpg",
    "cats/0a11ac55-eb0c-44d1-b7f7-baf4892ec68a/0a11ac55-eb0c-44d1-b7f7-baf4892ec68a_1770315627421_a4a8e3a4.jpg",
    "cats/0b5ab620-e18a-4b1d-b8a9-3073f608bc9d/0b5ab620-e18a-4b1d-b8a9-3073f608bc9d_1770152096556_13d4bb38.png",
    "cats/141b1de6-fa6a-46ad-afba-bcd320dfe822/141b1de6-fa6a-46ad-afba-bcd320dfe822_1770151788063_2d0c4bff.png",
    "cats/141b1de6-fa6a-46ad-afba-bcd320dfe822/141b1de6-fa6a-46ad-afba-bcd320dfe822_1770151789364_64b7aae3.png",
    "cats/17b6faf1-21ae-4509-a4ab-fe1a30acfd9a/17b6faf1-21ae-4509-a4ab-fe1a30acfd9a_1770152332089_00253bb0.png",
    "cats/17b6faf1-21ae-4509-a4ab-fe1a30acfd9a/17b6faf1-21ae-4509-a4ab-fe1a30acfd9a_1770152333477_dd34b8af.png",
    "cats/1af0a61b-14b6-4911-a19b-99f781a5bd10/1af0a61b-14b6-4911-a19b-99f781a5bd10_1770152650298_b6f41dc6.png",
    "cats/1af0a61b-14b6-4911-a19b-99f781a5bd10/1af0a61b-14b6-4911-a19b-99f781a5bd10_1770152650885_e84a8b30.png",
    "cats/1af0a61b-14b6-4911-a19b-99f781a5bd10/1af0a61b-14b6-4911-a19b-99f781a5bd10_1770152652217_c17fa6e3.png",
    "cats/1b027810-e091-4e6a-ab74-9b332f5119cf/1b027810-e091-4e6a-ab74-9b332f5119cf_1770152362287_7cf1cfe2.png",
    "cats/1b027810-e091-4e6a-ab74-9b332f5119cf/1b027810-e091-4e6a-ab74-9b332f5119cf_1770152364034_3f395ac6.png",
    "cats/235388f0-f4c2-409d-87a3-7f60a024aa94/235388f0-f4c2-409d-87a3-7f60a024aa94_1770315706952_f3aebd75.jpg",
    "cats/235388f0-f4c2-409d-87a3-7f60a024aa94/235388f0-f4c2-409d-87a3-7f60a024aa94_1770315708104_7a0e8bd0.jpg",
    "cats/237b3f00-b852-4267-bcf6-7fefa9fd3da7/237b3f00-b852-4267-bcf6-7fefa9fd3da7_1770152238523_bde2b098.png",
    "cats/237b3f00-b852-4267-bcf6-7fefa9fd3da7/237b3f00-b852-4267-bcf6-7fefa9fd3da7_1770152240140_8a5a4f3b.png",
    "cats/246825e4-c1ce-404c-825a-d0fa9c5b4e40/246825e4-c1ce-404c-825a-d0fa9c5b4e40_1770152178671_e6afbe53.png",
    "cats/2748c814-d928-4bc9-9932-3cfd3461d94b/2748c814-d928-4bc9-9932-3cfd3461d94b_1770152623660_f1e63b33.png",
    "cats/2748c814-d928-4bc9-9932-3cfd3461d94b/2748c814-d928-4bc9-9932-3cfd3461d94b_1770152624987_4d6f0ee3.png",
    "cats/2748c814-d928-4bc9-9932-3cfd3461d94b/2748c814-d928-4bc9-9932-3cfd3461d94b_1770152626276_d3d73ec0.png",
    "cats/2d8ebd5e-1b1e-4421-aa45-efa11538d24c/2d8ebd5e-1b1e-4421-aa45-efa11538d24c_1770151963010_3a5e0e55.png",
    "cats/3412876f-7c25-4bf6-a4ba-bdf49cf44417/3412876f-7c25-4bf6-a4ba-bdf49cf44417_1770315779497_b423ddad.jpg",
    "cats/3412876f-7c25-4bf6-a4ba-bdf49cf44417/3412876f-7c25-4bf6-a4ba-bdf49cf44417_1770315780679_31ab3b1e.jpg",
    "cats/3855b317-904e-4ef0-b827-8bf0c75b1cbc/3855b317-904e-4ef0-b827-8bf0c75b1cbc_1770151262680_1e34eda8.png",
    "cats/3855b317-904e-4ef0-b827-8bf0c75b1cbc/3855b317-904e-4ef0-b827-8bf0c75b1cbc_1770151264093_77d3dee2.png",
    "cats/3ac02240-0cd4-46a4-ac48-aa9fb60f3f9a/3ac02240-0cd4-46a4-ac48-aa9fb60f3f9a_1770315557979_b39ba5e5.jpg",
    "cats/3ac02240-0cd4-46a4-ac48-aa9fb60f3f9a/3ac02240-0cd4-46a4-ac48-aa9fb60f3f9a_1770315559312_fe6fbc9b.jpg",
    "cats/3c68e0e2-bf38-42ac-8f3e-eed2bfc0d24d/3c68e0e2-bf38-42ac-8f3e-eed2bfc0d24d_1770152149299_cc18b2b9.png",
    "cats/3c68e0e2-bf38-42ac-8f3e-eed2bfc0d24d/3c68e0e2-bf38-42ac-8f3e-eed2bfc0d24d_1770152150633_5c5daa35.png",
    "cats/3c68e0e2-bf38-42ac-8f3e-eed2bfc0d24d/3c68e0e2-bf38-42ac-8f3e-eed2bfc0d24d_1770152152053_a8e6e8e5.png",
    "cats/3c68e0e2-bf38-42ac-8f3e-eed2bfc0d24d/3c68e0e2-bf38-42ac-8f3e-eed2bfc0d24d_1770152153373_03f4ef65.png",
    "cats/3d99e11d-9c8c-42d2-9829-777748a3259d/3d99e11d-9c8c-42d2-9829-777748a3259d_1770152050773_40088c2e.png",
    "cats/3d99e11d-9c8c-42d2-9829-777748a3259d/3d99e11d-9c8c-42d2-9829-777748a3259d_1770152051773_dd98e35e.png",
    "cats/400258c3-4446-4483-8604-6f0fe197e94e/400258c3-4446-4483-8604-6f0fe197e94e_1770151839629_a38b58d5.png",
    "cats/4292955f-1706-418d-81f0-0cf81b2bd7cd/4292955f-1706-418d-81f0-0cf81b2bd7cd_1770151424336_4b425ced.png",
    "cats/456662aa-f615-459e-8059-199d78d9cac9/456662aa-f615-459e-8059-199d78d9cac9_1770151561879_fbb3a3f7.png",
    "cats/460be583-716a-4e85-8aaf-807c6827d0c5/460be583-716a-4e85-8aaf-807c6827d0c5_1770151299398_c96f0efe.png",
    "cats/460be583-716a-4e85-8aaf-807c6827d0c5/460be583-716a-4e85-8aaf-807c6827d0c5_1770151300772_ddf30e26.png",
    "cats/499f987a-022e-4686-ba86-9bfa62e9931a/499f987a-022e-4686-ba86-9bfa62e9931a_1770151501832_91f7b23b.png",
    "cats/51f9f9b2-3b81-4e81-92ff-7dec3cbeca2c/51f9f9b2-3b81-4e81-92ff-7dec3cbeca2c_1770152583633_0b2eb8a1.png",
    "cats/51f9f9b2-3b81-4e81-92ff-7dec3cbeca2c/51f9f9b2-3b81-4e81-92ff-7dec3cbeca2c_1770152585146_1f33bb9b.png",
    "cats/52273dee-138c-4f44-8e05-affa26ed89b1/52273dee-138c-4f44-8e05-affa26ed89b1_1770151592481_17e58d08.png",
    "cats/564e1981-4894-4254-9de5-0e72b70224c6/564e1981-4894-4254-9de5-0e72b70224c6_1770151696316_d2ddad57.png",
    "cats/564e1981-4894-4254-9de5-0e72b70224c6/564e1981-4894-4254-9de5-0e72b70224c6_1770151697558_37afe9a5.png",
    "cats/570aa879-e724-4dbb-8b19-84fda2b86161/570aa879-e724-4dbb-8b19-84fda2b86161_1770151633823_dfcede54.png",
    "cats/570aa879-e724-4dbb-8b19-84fda2b86161/570aa879-e724-4dbb-8b19-84fda2b86161_1770151635170_caf95fe0.png",
    "cats/59f6c186-2b36-497e-9cf0-a4019b2883ee/59f6c186-2b36-497e-9cf0-a4019b2883ee_1770152678571_15aec98e.png",
    "cats/59f6c186-2b36-497e-9cf0-a4019b2883ee/59f6c186-2b36-497e-9cf0-a4019b2883ee_1770152679988_fc24dba3.png",
    "cats/59f6c186-2b36-497e-9cf0-a4019b2883ee/59f6c186-2b36-497e-9cf0-a4019b2883ee_1770152681310_37fd95a9.png",
    "cats/5f7d1bcb-6c6f-4c7b-8a38-2839131d958e/5f7d1bcb-6c6f-4c7b-8a38-2839131d958e_1770151928655_7f1a6920.png",
    "cats/5f7d1bcb-6c6f-4c7b-8a38-2839131d958e/5f7d1bcb-6c6f-4c7b-8a38-2839131d958e_1770151929944_b0b3aaf2.png",
    "cats/6042690c-2174-41ea-898e-a36a0a6952c8/6042690c-2174-41ea-898e-a36a0a6952c8_1770151531048_7e6f1abe.png",
    "cats/635bc47a-d439-4afa-85b6-35155855b129/635bc47a-d439-4afa-85b6-35155855b129_1770315745893_a0d1a76f.jpg",
    "cats/635bc47a-d439-4afa-85b6-35155855b129/635bc47a-d439-4afa-85b6-35155855b129_1770315747087_b2029bc4.jpg",
    "cats/6572151a-4271-4254-ba61-d7afc089ab8f/6572151a-4271-4254-ba61-d7afc089ab8f_1770151729315_a93f5ab7.png",
    "cats/64d91d26-d8d3-48ed-962b-d54d879cfdec/64d91d26-d8d3-48ed-962b-d54d879cfdec_1770315590696_22f5a523.jpg",
    "cats/6caf7c91-169b-459a-86ee-16523ab0f804/6caf7c91-169b-459a-86ee-16523ab0f804_1770399395499_9a9a5af2.jpg",
    "cats/6caf7c91-169b-459a-86ee-16523ab0f804/6caf7c91-169b-459a-86ee-16523ab0f804_1770399396780_58e0b3f6.jpg",
    "cats/6db7d156-04dd-4d85-9800-bff7bfa86432/6db7d156-04dd-4d85-9800-bff7bfa86432_1770151475634_8841e099.png",
    "cats/6db7d156-04dd-4d85-9800-bff7bfa86432/6db7d156-04dd-4d85-9800-bff7bfa86432_1770151477024_33a60bd7.png",
    "cats/6ea80950-bc6b-4d0c-afaf-9dd641ec917c/6ea80950-bc6b-4d0c-afaf-9dd641ec917c_1770152394143_d8a4d5dd.png",
    "cats/6ea80950-bc6b-4d0c-afaf-9dd641ec917c/6ea80950-bc6b-4d0c-afaf-9dd641ec917c_1770152395548_4b75e5e6.png",
    "cats/72293926-b398-49aa-94fb-f7b1451498f7/72293926-b398-49aa-94fb-f7b1451498f7_1770152717299_a9df9b2e.png",
    "cats/72293926-b398-49aa-94fb-f7b1451498f7/72293926-b398-49aa-94fb-f7b1451498f7_1770152718506_49cce8eb.png",
    "cats/72293926-b398-49aa-94fb-f7b1451498f7/72293926-b398-49aa-94fb-f7b1451498f7_1770152719854_4b99ba0b.png",
    "cats/7d821707-bd06-492a-861d-5fb842ce1803/7d821707-bd06-492a-861d-5fb842ce1803_1770152207609_ce19c4e7.png",
    "cats/7d821707-bd06-492a-861d-5fb842ce1803/7d821707-bd06-492a-861d-5fb842ce1803_1770152209010_bf36a17d.png",
    "cats/819e9a7b-0b36-43e4-bce2-655ca4956b61/819e9a7b-0b36-43e4-bce2-655ca4956b61_1770151869064_fdb3b81b.png",
    "cats/819e9a7b-0b36-43e4-bce2-655ca4956b61/819e9a7b-0b36-43e4-bce2-655ca4956b61_1770151870505_de7a90f9.png",
    "cats/829eceea-8ce2-445e-9e9a-65c119944510/829eceea-8ce2-445e-9e9a-65c119944510_1770315677143_2a6bfdd0.jpg",
    "cats/829eceea-8ce2-445e-9e9a-65c119944510/829eceea-8ce2-445e-9e9a-65c119944510_1770315678315_37cab05e.jpg",
    "cats/87f6d30c-4f15-4640-ab0c-a0ca420057dc/87f6d30c-4f15-4640-ab0c-a0ca420057dc_1770315666411_75be4ee8.jpg",
    "cats/87f6d30c-4f15-4640-ab0c-a0ca420057dc/87f6d30c-4f15-4640-ab0c-a0ca420057dc_1770315667619_c9eca24b.jpg",
    "cats/8efb74ba-edda-492c-bb77-3e2a473f06da/8efb74ba-edda-492c-bb77-3e2a473f06da_1770315720082_adf4f7c0.jpg",
    "cats/8efb74ba-edda-492c-bb77-3e2a473f06da/8efb74ba-edda-492c-bb77-3e2a473f06da_1770315721296_e3b65ed7.jpg",
    "cats/903e7449-fc51-442a-bfe9-0ec5e2e90134/903e7449-fc51-442a-bfe9-0ec5e2e90134_1770151666107_7e6b314d.png",
    "cats/936abc63-e5a0-4e88-991c-315b14cb2090/936abc63-e5a0-4e88-991c-315b14cb2090_1770315638406_e1c2eab6.jpg",
    "cats/936abc63-e5a0-4e88-991c-315b14cb2090/936abc63-e5a0-4e88-991c-315b14cb2090_1770315639653_e6f25d0f.jpg",
    "cats/9308c297-14ca-48f4-ba6d-bb62b3b2a079/9308c297-14ca-48f4-ba6d-bb62b3b2a079_1770399543312_04464dfe.jpg",
    "cats/9308c297-14ca-48f4-ba6d-bb62b3b2a079/9308c297-14ca-48f4-ba6d-bb62b3b2a079_1770399545104_f91f1f73.jpg",
    "cats/9bbf6160-1a92-4ad6-9424-adf3c4cd5b2e/9bbf6160-1a92-4ad6-9424-adf3c4cd5b2e_1770315865118_4c89b298.jpg",
    "cats/9bbf6160-1a92-4ad6-9424-adf3c4cd5b2e/9bbf6160-1a92-4ad6-9424-adf3c4cd5b2e_1770315866320_5ea07b81.jpg",
    "cats/9fc5e6d5-2726-499e-bd63-ce3bccb9f8ef/9fc5e6d5-2726-499e-bd63-ce3bccb9f8ef_1770151390296_a4ef2ad0.png",
    "cats/a3e29de7-0055-43b8-b4bc-5ea78764c86c/a3e29de7-0055-43b8-b4bc-5ea78764c86c_1770152267953_acfc4cba.png",
    "cats/a3e29de7-0055-43b8-b4bc-5ea78764c86c/a3e29de7-0055-43b8-b4bc-5ea78764c86c_1770152269196_ed7f1f69.png",
    "cats/a7ddd6e5-162f-4d39-b0b4-355d4f950423/a7ddd6e5-162f-4d39-b0b4-355d4f950423_1770315803823_2012bab2.jpg",
    "cats/aa0930aa-a71e-433a-819d-6b26f169ff07/aa0930aa-a71e-433a-819d-6b26f169ff07_1770399568814_b5e6e7b9.jpg",
    "cats/aa0930aa-a71e-433a-819d-6b26f169ff07/aa0930aa-a71e-433a-819d-6b26f169ff07_1770399570137_59468b9f.jpg",
    "cats/ac6c36b8-c669-4678-9c78-fb8dd8e881a4/ac6c36b8-c669-4678-9c78-fb8dd8e881a4_1770151360203_b1b10ee1.png",
    "cats/ac6c36b8-c669-4678-9c78-fb8dd8e881a4/ac6c36b8-c669-4678-9c78-fb8dd8e881a4_1770151361593_1b5f4fa3.png",
    "cats/b5da5b4b-b229-4c87-bceb-0097306c3e7d/b5da5b4b-b229-4c87-bceb-0097306c3e7d_1770152122972_4a3dbc9f.png",
    "cats/bab7c744-695d-49be-8ca0-8c477c741d57/bab7c744-695d-49be-8ca0-8c477c741d57_1770151898977_a56aeb5d.png",
    "cats/bd664b6c-55bc-4498-abd8-5737f82cf616/bd664b6c-55bc-4498-abd8-5737f82cf616_1770151757814_b62b3b77.png",
    "cats/be078d63-78b3-4a46-b0ac-e39a72dd6351/be078d63-78b3-4a46-b0ac-e39a72dd6351_1770315837055_40a0ad91.jpg",
    "cats/c6e94573-cf0c-4743-83b6-51270f29daba/c6e94573-cf0c-4743-83b6-51270f29daba_1770152554026_e6d2df5c.png",
    "cats/c6e94573-cf0c-4743-83b6-51270f29daba/c6e94573-cf0c-4743-83b6-51270f29daba_1770152555292_15da5c71.png",
    "cats/c83bd161-5dda-45e9-803e-ecb6bb7afe14/c83bd161-5dda-45e9-803e-ecb6bb7afe14_1770315648890_2bb1e2bf.jpg",
    "cats/c83bd161-5dda-45e9-803e-ecb6bb7afe14/c83bd161-5dda-45e9-803e-ecb6bb7afe14_1770315650039_bd49203a.jpg",
    "cats/ca4f5283-7d83-4342-8a12-4f104eb09705/ca4f5283-7d83-4342-8a12-4f104eb09705_1770152753285_a8ea8d8d.png",
    "cats/ca4f5283-7d83-4342-8a12-4f104eb09705/ca4f5283-7d83-4342-8a12-4f104eb09705_1770152754558_84fdc3a8.png",
    "cats/ca4f5283-7d83-4342-8a12-4f104eb09705/ca4f5283-7d83-4342-8a12-4f104eb09705_1770152755896_1b5b2eea.png",
    "cats/cd06eaea-bc49-4dba-9c4e-fae3f006fe31/cd06eaea-bc49-4dba-9c4e-fae3f006fe31_1770399453165_cc67df16.jpg",
    "cats/cd06eaea-bc49-4dba-9c4e-fae3f006fe31/cd06eaea-bc49-4dba-9c4e-fae3f006fe31_1770399454489_9fdd2d38.jpg",
    "cats/cd06eaea-bc49-4dba-9c4e-fae3f006fe31/cd06eaea-bc49-4dba-9c4e-fae3f006fe31_1770399455810_b4bc5893.jpg",
    "cats/d12f7735-84b4-455c-b025-379579e52185/d12f7735-84b4-455c-b025-379579e52185_1770399257133_95a18067.jpg",
    "cats/d12f7735-84b4-455c-b025-379579e52185/d12f7735-84b4-455c-b025-379579e52185_1770399258428_84a37f50.jpg",
    "cats/d53e2923-8502-44e8-b27a-8ca3838f0399/d53e2923-8502-44e8-b27a-8ca3838f0399_1770399289380_0ada9ced.jpg",
    "cats/d53e2923-8502-44e8-b27a-8ca3838f0399/d53e2923-8502-44e8-b27a-8ca3838f0399_1770399290617_79ae1bab.jpg",
    "cats/d6ed7c12-1c20-4296-8d2c-64a3bece1ab2/d6ed7c12-1c20-4296-8d2c-64a3bece1ab2_1770315530005_aaada426.jpg",
    "cats/d6ed7c12-1c20-4296-8d2c-64a3bece1ab2/d6ed7c12-1c20-4296-8d2c-64a3bece1ab2_1770315531297_ade2fdcb.jpg",
    "cats/dbf2e643-426d-479e-85f1-9fe3d1a3c9a0/dbf2e643-426d-479e-85f1-9fe3d1a3c9a0_1770399174785_7b98f8d2.jpg",
    "cats/dbf2e643-426d-479e-85f1-9fe3d1a3c9a0/dbf2e643-426d-479e-85f1-9fe3d1a3c9a0_1770399176082_21093b85.jpg",
    "cats/dbf2e643-426d-479e-85f1-9fe3d1a3c9a0/dbf2e643-426d-479e-85f1-9fe3d1a3c9a0_1770399177380_a53d5f30.jpg",
    "cats/dbf2e643-426d-479e-85f1-9fe3d1a3c9a0/dbf2e643-426d-479e-85f1-9fe3d1a3c9a0_1770399178712_bfbf2e20.jpg",
    "cats/df9d02b3-1199-4f64-9e76-299577c645c5/df9d02b3-1199-4f64-9e76-299577c645c5_1770152019652_75a50acd.png",
    "cats/df9d02b3-1199-4f64-9e76-299577c645c5/df9d02b3-1199-4f64-9e76-299577c645c5_1770152021171_c0157db0.png",
    "cats/e1a55dba-9eec-4967-b2a3-550d0dffb0a3/e1a55dba-9eec-4967-b2a3-550d0dffb0a3_1770151809715_4b4f0e2d.png",
    "cats/e3248771-1fad-446d-8624-8f3c1f230083/e3248771-1fad-446d-8624-8f3c1f230083_1770152298583_90db53a4.png",
    "cats/e3248771-1fad-446d-8624-8f3c1f230083/e3248771-1fad-446d-8624-8f3c1f230083_1770152299851_b28e4bb4.png",
    "cats/e8d618ee-44fe-4390-97b9-121a6487af4a/e8d618ee-44fe-4390-97b9-121a6487af4a_1770151331256_c58915ba.png",
    "cats/e926ac61-0d6f-4cc7-969d-899bbdbb19ed/e926ac61-0d6f-4cc7-969d-899bbdbb19ed_1770399420971_fbe34e44.jpg",
    "cats/e926ac61-0d6f-4cc7-969d-899bbdbb19ed/e926ac61-0d6f-4cc7-969d-899bbdbb19ed_1770399422285_5b0ddddf.jpg",
    "cats/e9615084-6d90-45c5-be8b-719acf203179/e9615084-6d90-45c5-be8b-719acf203179_1770315608339_fe6dbd16.jpg",
    "cats/ec4be000-7393-4618-a49d-72e9a2715d80/ec4be000-7393-4618-a49d-72e9a2715d80_1770399597749_2adcbb51.jpg",
    "cats/ec4be000-7393-4618-a49d-72e9a2715d80/ec4be000-7393-4618-a49d-72e9a2715d80_1770399599066_e6ea0a67.jpg",
    "cats/ecae6873-7254-4485-82ac-a7d56c8fdc12/ecae6873-7254-4485-82ac-a7d56c8fdc12_1770315759298_ccc44b5d.jpg",
    "cats/ecae6873-7254-4485-82ac-a7d56c8fdc12/ecae6873-7254-4485-82ac-a7d56c8fdc12_1770315760494_0a6c12e7.jpg",
    "cats/f2b4f153-0e45-4b30-9b83-696e9e7cc5f6/f2b4f153-0e45-4b30-9b83-696e9e7cc5f6_1770315688399_1e38bcd9.jpg",
    "cats/f2b4f153-0e45-4b30-9b83-696e9e7cc5f6/f2b4f153-0e45-4b30-9b83-696e9e7cc5f6_1770315689664_f8db8b17.jpg",
    "cats/f3cebdf9-7e0a-4e39-bbdf-7f3fdd5368fd/f3cebdf9-7e0a-4e39-bbdf-7f3fdd5368fd_1770399225361_69195ff3.jpg",
    "cats/f3cebdf9-7e0a-4e39-bbdf-7f3fdd5368fd/f3cebdf9-7e0a-4e39-bbdf-7f3fdd5368fd_1770399226620_c0f73bd5.jpg",
    "cats/f5c0f61c-4744-4049-b098-358ee5cb1c33/f5c0f61c-4744-4049-b098-358ee5cb1c33_1770399140155_67a0d8e9.jpg",
    "cats/f5c0f61c-4744-4049-b098-358ee5cb1c33/f5c0f61c-4744-4049-b098-358ee5cb1c33_1770399141436_29aa9ae3.jpg",
    "cats/ffaddb55-9cd8-4751-991b-4c7bdc820215/ffaddb55-9cd8-4751-991b-4c7bdc820215_1770399345252_d1f0db16.jpg",
    "cats/ffaddb55-9cd8-4751-991b-4c7bdc820215/ffaddb55-9cd8-4751-991b-4c7bdc820215_1770399346552_8ebab81f.jpg",
  ];

  return photos;
}
