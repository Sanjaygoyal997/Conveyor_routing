namespace ConveyorRouting.Api.Models
{
    /// <summary>WIP selection shared by readiness, demand and machine check.</summary>
    public class WipFilter
    {
        /// <summary>Look-back window in hours (default 2 days).</summary>
        public int Hours { get; set; } = 48;
        /// <summary>Comma-separated curing state codes; blank = all.</summary>
        public string Wip_States { get; set; }
        /// <summary>Comma-separated routable quality_status codes; blank = all.</summary>
        public string Ok_Quality { get; set; }
        /// <summary>Machine area (area_master.local_area_id); blank = DBM.</summary>
        public int? Area_Id { get; set; }
        public bool Exclude_At_Dbm { get; set; } = true;
    }

    public class MaterialRimIn
    {
        public int Material_Id { get; set; }
        public int Rim_Id { get; set; }
        public int? Area_Id { get; set; }
    }

    public class AreaIn
    {
        public int Area_Id { get; set; }
    }

    public class RimIn
    {
        public int Rim_Id { get; set; }
    }

    public class DedupeIn
    {
        public int Material_Id { get; set; }
        public int? Area_Id { get; set; }
        public string Rim_Size { get; set; }
    }

    /// <summary>A failed business rule in a fix (400/401/403/404/409/422).</summary>
    public class FixException : System.Exception
    {
        public int StatusCode { get; }
        public FixException(int statusCode, string message) : base(message) { StatusCode = statusCode; }
    }
}
