using System.Collections.Generic;

namespace ConveyorRouting.Api.Models
{
    // Same response envelope as SmartMES_ReportAPI.
    public class OEMResponse
    {
        public int StatusCode { get; set; }
        public object Data { get; set; }
        public string Message { get; set; }
        public List<ErrorMessageDetail> error { get; set; }

        public static OEMResponse Ok(object data, string message) =>
            new OEMResponse { StatusCode = 200, Data = data, Message = message, error = null };

        public static OEMResponse Fail(int statusCode, string message) =>
            new OEMResponse
            {
                StatusCode = statusCode,
                Data = null,
                Message = message,
                error = new List<ErrorMessageDetail> { new ErrorMessageDetail { StatusCode = statusCode.ToString(), Message = message } }
            };
    }

    public class ErrorMessageDetail
    {
        public string field { get; set; }
        public string StatusCode { get; set; }
        public string Message { get; set; }
    }
}
