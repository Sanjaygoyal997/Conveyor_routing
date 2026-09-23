using ConveyorRouting.Api.Models;

namespace ConveyorRouting.Api.Interfaces.IRepository
{
    public interface IRimFixRepository
    {
        (string message, int id) AddMaterialRim(MaterialRimIn body, string user);
        string RemoveMaterialRim(int rowId, string user);
        string SetMaterialRimArea(int rowId, int areaId, string user);
        string ChangeMaterialRim(int rowId, int rimId, string user);
        string DedupeMaterialRim(DedupeIn body, string user);
        string SetRunningRim(int equipmentId, int rimId, string user);
        string ActivateRim(int rimId, string user);
    }
}
