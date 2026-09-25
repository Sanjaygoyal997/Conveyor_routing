using ConveyorRouting.Api.Models;

namespace ConveyorRouting.Api.Interfaces.IServices
{
    public interface IRimValidationService
    {
        OEMResponse Health();
        OEMResponse Config();
        OEMResponse WipReadiness(WipFilter f);
        OEMResponse WipDemand(WipFilter f);
        OEMResponse WipMachines(WipFilter f);
        OEMResponse Gaps(int hours, int? areaId);
        OEMResponse Areas();
        OEMResponse RunningSizes(int? areaId, int hours);
        OEMResponse DbmMachines(int days);
        OEMResponse Rims();
        OEMResponse Equipment();
        OEMResponse MaterialMapping(int materialId);
        OEMResponse Audit(int limit);
        OEMResponse Barcode(string barcode, int? equipmentId, int? areaId, string okQuality);
    }
}
