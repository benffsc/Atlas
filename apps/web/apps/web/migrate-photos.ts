import { createClient } from '@supabase/supabase-js';

const V1_SUPABASE_URL = 'https://tpjllrfpdlkenbapvpko.supabase.co';
const V1_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY_EAST!;

const V2_SUPABASE_URL = 'https://afxpboxisgoxttyrbtpw.supabase.co';
const V2_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

// V1 cat_id → V2 cat_id mapping (from microchip)
const mapping: Record<string, string> = {
  '3855b317-904e-4ef0-b827-8bf0c75b1cbc': '54b4bec8-d924-4d73-b4c8-4c64ae6b7582',
  'e8d618ee-44fe-4390-97b9-121a6487af4a': '394cb9cf-4d23-4c42-bfb0-4e42a16bf447',
  '460be583-716a-4e85-8aaf-807c6827d0c5': '8842d745-46fa-4ad3-a602-4ce9b1611ba4',
  '03b96f0d-cb10-45ac-baa7-17751abd1986': 'e980c42e-a103-4e2d-ad55-06dacb214651',
  '246825e4-c1ce-404c-825a-d0fa9c5b4e40': 'cd0b0cf7-3984-48f0-9f3f-9e4a085171f7',
  'ac6c36b8-c669-4678-9c78-fb8dd8e881a4': 'b6d38b57-1d12-4b89-a3ab-5256686cec56',
  '6db7d156-04dd-4d85-9800-bff7bfa86432': '9ddb7b7b-1e87-45e9-84fc-c3eadfd170bd',
  'ec4be000-7393-4618-a49d-72e9a2715d80': 'ff88f309-fee9-494d-9f4b-12e17d57d406',
  '2748c814-d928-4bc9-9932-3cfd3461d94b': '39d64d52-5103-4a4a-a44a-6d0653f89fe0',
  'c6e94573-cf0c-4743-83b6-51270f29daba': '7346a863-4c6b-4a37-b368-91669e712d16',
  '51f9f9b2-3b81-4e81-92ff-7dec3cbeca2c': '366f8993-c78f-4019-a076-b2f9b8c3bf8e',
  'e3248771-1fad-446d-8624-8f3c1f230083': 'bb70e140-3cd9-4b32-80a3-fd54d34427a6',
  '59f6c186-2b36-497e-9cf0-a4019b2883ee': 'a8197204-a8a3-42c4-a52f-818baba22f28',
  '499f987a-022e-4686-ba86-9bfa62e9931a': 'ab23bf85-12d1-4886-9dd2-f1d2d0baff48',
  'dbf2e643-426d-479e-85f1-9fe3d1a3c9a0': 'f9afec0e-c797-497e-bece-9b78d4ee0c72',
  '0b5ab620-e18a-4b1d-b8a9-3073f608bc9d': 'f0f368b5-c8de-4087-8019-2bf23d365660',
  '903e7449-fc51-442a-bfe9-0ec5e2e90134': 'ba597239-5c6c-4d14-818c-a494f88cd554',
  '564e1981-4894-4254-9de5-0e72b70224c6': '4227e01e-0ae0-4866-bac1-2666e60d5b95',
  'b5da5b4b-b229-4c87-bceb-0097306c3e7d': '5c9ae2cf-f9fb-4129-9189-9cda3a44dccf',
  '6042690c-2174-41ea-898e-a36a0a6952c8': '21e7c778-332d-46df-a53b-3d617c9a8b4e',
  '456662aa-f615-459e-8059-199d78d9cac9': '8fcccff9-b38b-45b9-91b6-ed07fec561c1',
  '52273dee-138c-4f44-8e05-affa26ed89b1': 'b58721ac-f130-47a4-bc54-90d3759086a3',
  'c83bd161-5dda-45e9-803e-ecb6bb7afe14': 'b37a88ac-3c21-41ea-ba0f-f219151858fe',
  '570aa879-e724-4dbb-8b19-84fda2b86161': '5fcf3c55-709d-4be3-ad60-5e340eb2cddb',
  '4292955f-1706-418d-81f0-0cf81b2bd7cd': '9c46d86b-0ea0-40d5-ad9f-239783d38cb2',
  '9fc5e6d5-2726-499e-bd63-ce3bccb9f8ef': '59b2829d-fdda-4dfd-a534-88ba3f531d92',
  '6ea80950-bc6b-4d0c-afaf-9dd641ec917c': '3cc380ce-2c82-468e-bc68-1cf905a1b809',
  '17b6faf1-21ae-4509-a4ab-fe1a30acfd9a': '2bb7e3fe-a56d-41a8-9f36-9e25a06844b3',
  '829eceea-8ce2-445e-9e9a-65c119944510': '7d448ca9-5a1b-4b91-a133-18c2832f7bc8',
  '1b027810-e091-4e6a-ab74-9b332f5119cf': '992727fe-c755-42dc-8d92-91a63e0fc779',
  '235388f0-f4c2-409d-87a3-7f60a024aa94': '6a18440f-67e4-4b43-8b0e-9afdf1e5f874',
  'bd664b6c-55bc-4498-abd8-5737f82cf616': '4dc234c9-8f7f-4618-b9d9-91c69e48dbc5',
  '141b1de6-fa6a-46ad-afba-bcd320dfe822': '442c2e12-485b-41d0-b1b3-bf93fbfc1f84',
  '05cb110b-2312-4ecf-9d64-2613f2369c6d': '4770993b-3373-4cc5-a3c2-642e7cce8f0d',
  '72293926-b398-49aa-94fb-f7b1451498f7': 'e89993fd-cec3-4c57-8e5b-2904a26928e5',
  'ca4f5283-7d83-4342-8a12-4f104eb09705': '747f726d-846e-4be9-ad9b-0856a651e2aa',
  '1af0a61b-14b6-4911-a19b-99f781a5bd10': '57111a7d-4140-44ad-a664-c51668bd39da',
  'f5c0f61c-4744-4049-b098-358ee5cb1c33': 'd74431fc-f223-4c26-a2de-6ab9069aa9c9',
  'df9d02b3-1199-4f64-9e76-299577c645c5': 'c250b287-a4c3-45a6-bd20-14d9c01cef06',
  '261742cf-675b-4a87-bd46-d8f0130b2929': 'a1d53922-8711-4695-9e9b-991d93d1d558',
  'aa0930aa-a71e-433a-819d-6b26f169ff07': 'ca68ad5e-2064-4bf4-bf65-110146821aea',
  '049fa64f-4fa1-4d21-a779-22f5622a1d7e': '17eadfc5-7536-4d8d-ba67-7141c2338996',
  '55cd67ad-dc66-4ec7-bf39-292fb6bffc6c': 'ac0f20a4-20c7-47ee-9c5e-1ef6a6fcf32e',
  '6572151a-4271-4254-ba61-d7afc089ab8f': '6e4e23d3-bce1-4358-84c4-a0393618dac8',
  '6caf7c91-169b-459a-86ee-16523ab0f804': 'fe8def39-64f9-4ff5-aaf3-eb61af59b677',
  'e926ac61-0d6f-4cc7-969d-899bbdbb19ed': '28829280-399b-4345-80ee-7995d6603e26',
  'cd06eaea-bc49-4dba-9c4e-fae3f006fe31': '84559421-c01c-4f27-8668-aee063691b4a',
  'f3cebdf9-7e0a-4e39-bbdf-7f3fdd5368fd': '67c7dafc-3dfa-48b6-b337-c49fa562297b',
  '3c68e0e2-bf38-42ac-8f3e-eed2bfc0d24d': '1a606c43-ca5f-41e6-8750-896891b3a7f2',
  'ecae6873-7254-4485-82ac-a7d56c8fdc12': 'b02172f1-6a59-439e-9129-a83228d16c70',
  '0431456f-5a1b-4a05-a5fb-662f20bfd838': '473fd62a-cde8-4097-8bcd-2c4b0657b188',
  'a7ddd6e5-162f-4d39-b0b4-355d4f950423': '54eac3eb-34c2-484e-9195-ab059c29a2a1',
  'd12f7735-84b4-455c-b025-379579e52185': '87cc0d30-5786-42b7-bbd6-5c812e71ace3',
  '3412876f-7c25-4bf6-a4ba-bdf49cf44417': '88d41f14-b767-489e-bd97-3f5902bfe816',
  'ffaddb55-9cd8-4751-991b-4c7bdc820215': '27dd939f-764c-4c73-acd9-98602298d547',
  '3d99e11d-9c8c-42d2-9829-777748a3259d': '72c2ea3a-1569-416a-b6b1-52a2b59070c7',
  'be078d63-78b3-4a46-b0ac-e39a72dd6351': '3eb0f1f4-f4a9-46a3-b926-c9bb4ff1876e',
  '237b3f00-b852-4267-bcf6-7fefa9fd3da7': '1ba08b29-aaba-4378-8d96-a7234c99a2cc',
  'd53e2923-8502-44e8-b27a-8ca3838f0399': '915f0a2c-8f60-47a5-be10-f5cb39286c40',
  '9308c297-14ca-48f4-ba6d-bb62b3b2a079': '3c95e6fb-2426-47b5-ac32-cf785cfa7ae4',
  'a3e29de7-0055-43b8-b4bc-5ea78764c86c': '39b59b57-25ac-4e8a-a241-9f2ffb3fa266',
  '7d821707-bd06-492a-861d-5fb842ce1803': 'ba2e5b02-d6d9-4bc4-8022-2b710c34dbf8',
  '9bbf6160-1a92-4ad6-9424-adf3c4cd5b2e': '8d50ed75-c53d-41b6-a04b-7c6bacea0267',
  '400258c3-4446-4483-8604-6f0fe197e94e': '0717e1bf-b95d-4149-8ae8-abf1a042eedf',
  'e1a55dba-9eec-4967-b2a3-550d0dffb0a3': '71dd907c-b4ec-4a2f-a94c-a1cbb494327c',
  '819e9a7b-0b36-43e4-bce2-655ca4956b61': '4729c4c9-eedf-47c7-b201-9d448492f171',
  'bab7c744-695d-49be-8ca0-8c477c741d57': 'cc295dfe-7589-45a0-b75c-62aec6325061',
  '2d8ebd5e-1b1e-4421-aa45-efa11538d24c': '3d274005-8ebd-43ad-a435-9bd0ffc3dca1',
  '5f7d1bcb-6c6f-4c7b-8a38-2839131d958e': '32ee8660-4656-414e-abd7-e52ebc84235c',
  '87f6d30c-4f15-4640-ab0c-a0ca420057dc': 'a4292a63-5e25-403c-bc62-fa400ae34687',
  'f2b4f153-0e45-4b30-9b83-696e9e7cc5f6': 'c54d768d-d97b-4ceb-8bfb-57814b64744a',
  '635bc47a-d439-4afa-85b6-35155855b129': '13b8599d-f334-4773-83a1-7c21c5a2306b',
  '8efb74ba-edda-492c-bb77-3e2a473f06da': 'cb7687a2-51b4-4cfe-9e71-e503d1c4cc68',
  '936abc63-e5a0-4e88-991c-315b14cb2090': '319b9bc4-e02e-4b81-a1e0-1d00b9b43951',
  '64d91d26-d8d3-48ed-962b-d54d879cfdec': '4575c1b3-2342-48f2-a952-2be094f73ea7',
  '3ac02240-0cd4-46a4-ac48-aa9fb60f3f9a': '90942904-fcb4-4070-88ea-b4b21487483e',
  'd6ed7c12-1c20-4296-8d2c-64a3bece1ab2': '6bb61dfe-f919-4aee-8c81-19823a15907f',
  'e9615084-6d90-45c5-be8b-719acf203179': '7c506161-0bcc-4de3-ba5c-b50fcf326f85',
  '0a11ac55-eb0c-44d1-b7f7-baf4892ec68a': '333a30cb-1a5e-4fb1-a1fe-77adfbd174f1',
};

async function main() {
  console.log('=== V1 → V2 Cat Photo Migration ===\n');

  if (!V1_SERVICE_KEY || !V2_SERVICE_KEY) {
    console.error('Missing service keys');
    process.exit(1);
  }

  const v1 = createClient(V1_SUPABASE_URL, V1_SERVICE_KEY);
  const v2 = createClient(V2_SUPABASE_URL, V2_SERVICE_KEY);

  // List all photos in V1
  const { data: folders } = await v1.storage.from('request-media').list('cats');
  if (!folders) {
    console.error('No folders found');
    return;
  }

  let migrated = 0, skipped = 0, errors = 0;

  for (const folder of folders) {
    const v1CatId = folder.name;
    const v2CatId = mapping[v1CatId];
    
    if (!v2CatId) {
      console.log(`SKIP: No V2 mapping for ${v1CatId}`);
      skipped++;
      continue;
    }

    const { data: files } = await v1.storage.from('request-media').list(`cats/${v1CatId}`);
    if (!files?.length) continue;

    for (const file of files) {
      const v1Path = `cats/${v1CatId}/${file.name}`;
      const v2Path = `cats/${v2CatId}/${file.name}`;

      // Check if exists in V2
      const { data: existing } = await v2.storage.from('request-media').list(`cats/${v2CatId}`, { search: file.name });
      if (existing?.length) {
        console.log(`EXISTS: ${v2Path}`);
        skipped++;
        continue;
      }

      // Download from V1
      const { data: fileData, error: dlErr } = await v1.storage.from('request-media').download(v1Path);
      if (dlErr) {
        console.error(`ERROR dl ${v1Path}:`, dlErr.message);
        errors++;
        continue;
      }

      // Upload to V2
      const contentType = file.name.endsWith('.png') ? 'image/png' : 'image/jpeg';
      const { error: ulErr } = await v2.storage.from('request-media').upload(v2Path, fileData, { contentType, upsert: false });
      if (ulErr) {
        console.error(`ERROR ul ${v2Path}:`, ulErr.message);
        errors++;
        continue;
      }

      console.log(`✓ ${v1CatId} → ${v2Path}`);
      migrated++;
    }
  }

  console.log(`\n=== Migration Complete ===`);
  console.log(`   Migrated: ${migrated}`);
  console.log(`   Skipped: ${skipped}`);
  console.log(`   Errors: ${errors}`);
}

main().catch(console.error);
