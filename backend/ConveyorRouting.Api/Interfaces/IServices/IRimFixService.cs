using ConveyorRouting.Api.Models;

namespace ConveyorRouting.Api.Interfaces.IServices
{
    /// <summary>Master-data fixes. user/adminToken are the X-User / X-Admin-Token headers.</summary>
    public interface IRimFixService
    {
        OEMResponse AddMaterialRim(MaterialRimIn body, string user, string adminToken);
        OEMResponse RemoveMaterialRim(int rowId, string user, string adminToken);
        OEMResponse SetMaterialRimArea(int rowId, AreaIn body, string user, string adminToken);
        OEMResponse ChangeMaterialRim(int rowId, RimIn body, string user, string adminToken);
        OEMResponse DedupeMaterialRim(DedupeIn body, string user, string adminToken);
        OEMResponse SetRunningRim(int equipmentId, RimIn body, string user, string adminToken);
        OEMResponse ActivateRim(int rimId, string user, string adminToken);
    }
}
