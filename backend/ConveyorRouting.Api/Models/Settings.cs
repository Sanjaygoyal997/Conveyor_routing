namespace ConveyorRouting.Api.Models
{
    public class JwtSettings
    {
        public string Key { get; set; }
    }

    public class RimValidationSettings
    {
        /// <summary>Master switch for the fix endpoints (default off).</summary>
        public bool AllowWrites { get; set; }
        /// <summary>When set, every change must send X-Admin-Token with this value.</summary>
        public string AdminToken { get; set; } = "";
        /// <summary>What is written into rim_size columns: "rim_id" (default) or "name".</summary>
        public string RimSizeValue { get; set; } = "rim_id";
        public int StatementTimeoutSeconds { get; set; } = 60;
        /// <summary>Require a JWT (same key as SmartMES_ReportAPI) on the API.</summary>
        public bool RequireJwt { get; set; } = true;
    }
}
