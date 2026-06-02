// Copie este arquivo para secrets.h e preencha com os seus valores reais.
// O arquivo secrets.h fica fora do Git para evitar vazamento de credenciais.

static const char* WIFI_SSID = "SEU_WIFI";
static const char* WIFI_PASSWORD = "SUA_SENHA_WIFI";
static const char* API_BASE_URL = "https://sua-api.vercel.app";
static const char* DEVICE_API_KEY = "troque-pela-chave-individual-do-device";
static const char* DEVICE_ID = "d1mini_01";
static const bool DEVICE_ALLOW_INSECURE_TLS = false;

static const char* API_ROOT_CA = R"EOF(
-----BEGIN CERTIFICATE-----
COLE_AQUI_A_RAIZ_CA_DA_SUA_API
-----END CERTIFICATE-----
)EOF";
