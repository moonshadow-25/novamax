import axios from 'axios';

const API_BASE = 'http://localhost:3001/api';
const MODELSCOPE_TOKEN = 'ms-39cb51cd-80a2-4dfc-8e1f-e820a8dcbe98';
const USERNAME = 'shoujiekeji';

async function main() {
  try {
    console.log('Setting ModelScope token...');
    await axios.post(`${API_BASE}/modelscope/token`, {
      token: MODELSCOPE_TOKEN
    });
    console.log('✓ Token set successfully\n');

    console.log(`Fetching NovaAI models from user: ${USERNAME}...`);
    const modelsResponse = await axios.get(
      `${API_BASE}/modelscope/user/${USERNAME}/models`
    );

    const models = modelsResponse.data.models;
    console.log(`✓ Found ${models.length} NovaAI models:\n`);

    models.forEach((model, index) => {
      console.log(`${index + 1}. ${model.Name}`);
      console.log(`   Owner: ${model.Owner}`);
      console.log(`   Description: ${model.Description || 'N/A'}`);
      console.log('');
    });

    console.log('Auto-importing models...');
    const importResponse = await axios.post(
      `${API_BASE}/modelscope/auto-import/${USERNAME}`
    );

    console.log(`\n✓ Successfully imported ${importResponse.data.imported} models:\n`);

    importResponse.data.models.forEach((model, index) => {
      console.log(`${index + 1}. ${model.name}`);
      console.log(`   ID: ${model.id}`);
      console.log(`   Type: ${model.type}`);
      console.log(`   Path: ${model.path}`);
      console.log('');
    });

    console.log('All models imported successfully!');
  } catch (error) {
    console.error('Error:', error.response?.data || error.message);
  }
}

main();
