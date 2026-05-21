// Mock data for PocketBase API responses

export const PB_MOCK_SUCCESS_LIST = {
  "page": 1,
  "perPage": 30,
  "totalPages": 1,
  "totalItems": 2,
  "items": [
    {
      "collectionId": "pb_ACCOUNTLIST_V1",
      "collectionName": "ACCOUNTLIST_V1",
      "_userid": "RECORD_ID",
      "id": "vtm3zxi6yisaug0",
      "ACCOUNTID": 123.456,
      "ACCOUNTNAME": "example text",
      "ACCOUNTTYPE": "example text",
      "ACCOUNTNUM": "example text",
      "STATUS": "example text",
      "NOTES": "example text",
      "HELDAT": "example text",
      "WEBSITE": "example text",
      "CONTACTINFO": "example text",
      "ACCESSINFO": "example text",
      "INITIALBAL": 123.456,
      "INITIALDATE": "2026-05-21 13:02:24.464Z",
      "FAVORITEACCT": "example text",
      "CURRENCYID": 123.456,
      "STATEMENTLOCKED": 123.456,
      "STATEMENTDATE": "example text",
      "MINIMUMBALANCE": 123.456,
      "CREDITLIMIT": 123.456,
      "INTERESTRATE": 123.456,
      "PAYMENTDUEDATE": "example text",
      "MINIMUMPAYMENT": 123.456,
      "_is_deleted": 123.456,
      "_updated_at": "example text",
      "created": "2026-05-21 13:02:24.464Z",
      "updated": "2026-05-21 13:02:24.464Z"
    }
  ]
};

export const PB_MOCK_SUCCESS_RECORD = PB_MOCK_SUCCESS_LIST.items[0];

export const PB_MOCK_ERROR_400 = {
  "status": 400,
  "message": "Something went wrong while processing your request.",
  "data": {}
};

export const PB_MOCK_ERROR_409 = {
  "status": 409,
  "message": "Conflict - Record on server is more recent.",
  "data": {}
};
